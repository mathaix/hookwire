import { execFile, spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import pg from "pg";
import { migrate, resetDatabase } from "../packages/db/src/migrate.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;
const outputPath = new URL("../docs/reviews/2026-06-19-issue-005-api-proof.json", import.meta.url);
const port = 3025;
const baseUrl = `http://127.0.0.1:${port}`;
const internalApiSecret = "issue-005-proof-secret";

async function docker(args) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function startPostgres() {
  const name = `hookwire-api-proof-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_api_proof",
    "-p",
    "127.0.0.1::5432",
    "postgres:16"
  ]);
  const containerId = stdout.trim();
  const { stdout: portStdout } = await docker(["port", containerId, "5432/tcp"]);
  const match = portStdout.trim().match(/:(\d+)$/);
  if (!match) {
    throw new Error(`Could not parse Docker port output: ${portStdout}`);
  }

  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${match[1]}/hookwire_api_proof`;
  await waitForPostgres(databaseUrl);

  return { containerId, databaseUrl };
}

async function waitForPostgres(databaseUrl) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < 20_000) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw lastError;
}

async function withClient(databaseUrl, callback) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function seedDecisionApiGraph(databaseUrl) {
  return withClient(databaseUrl, async (client) => {
    const { rows: orgRows } = await client.query(`
      insert into organizations (name, slug)
      values ('Acme Engineering', 'acme-engineering'), ('Globex', 'globex')
      returning id, slug
    `);
    const organizationId = orgRows.find((row) => row.slug === "acme-engineering").id;
    const otherOrganizationId = orgRows.find((row) => row.slug === "globex").id;

    const { rows: userRows } = await client.query(`
      insert into users (email, name)
      values
        ('maya@acme.dev', 'Maya W.'),
        ('viewer@acme.dev', 'Vic Viewer'),
        ('owner@globex.dev', 'Globex Owner')
      returning id, email
    `);
    const admin = userRows.find((row) => row.email === "maya@acme.dev").id;
    const viewer = userRows.find((row) => row.email === "viewer@acme.dev").id;
    const otherOrgAdmin = userRows.find((row) => row.email === "owner@globex.dev").id;

    await client.query(
      `
        insert into memberships (organization_id, user_id, role)
        values ($1, $2, 'admin'), ($1, $3, 'viewer'), ($4, $5, 'admin')
      `,
      [organizationId, admin, viewer, otherOrganizationId, otherOrgAdmin]
    );

    const { rows: projectRows } = await client.query(
      `
        insert into projects (organization_id, name, slug, repo_provider, repo_owner, repo_name)
        values ($1, 'hookwire/web', 'hookwire-web', 'github', 'mathaix', 'hookwire')
        returning id
      `,
      [organizationId]
    );
    const projectId = projectRows[0].id;

    const { rows: routeRows } = await client.query(
      `
        insert into routes (organization_id, name, approvals_required, timeout_seconds)
        values ($1, 'Web inbox', 1, 900)
        returning id
      `,
      [organizationId]
    );
    const routeId = routeRows[0].id;

    const { rows: toolRows } = await client.query(
      `
        insert into agent_tools (organization_id, project_id, agent_type, display_name, created_by_user_id)
        values ($1, $2, 'codex', 'Codex', $3)
        returning id
      `,
      [organizationId, projectId, admin]
    );
    const agentToolId = toolRows[0].id;

    const { rows: installationRows } = await client.query(
      `
        insert into agent_installations (
          organization_id, project_id, agent_tool_id, agent_type, registered_by_user_id, owner_user_id,
          machine_fingerprint
        )
        values ($1, $2, $3, 'codex', $4, $4, 'issue-005-api-proof-machine')
        returning id
      `,
      [organizationId, projectId, agentToolId, admin]
    );
    const installationId = installationRows[0].id;

    const { rows: sessionRows } = await client.query(
      `
        insert into agent_sessions (
          organization_id, project_id, agent_tool_id, agent_installation_id, agent_type, external_session_id,
          started_by_user_id
        )
        values ($1, $2, $3, $4, 'codex', 'codex-issue-005-proof', $5)
        returning id
      `,
      [organizationId, projectId, agentToolId, installationId, admin]
    );
    const sessionId = sessionRows[0].id;

    const { rows: requestRows } = await client.query(
      `
        insert into approval_requests (
          organization_id, project_id, agent_tool_id, agent_installation_id, agent_session_id, status,
          risk_level, route_id, requested_by_agent, action_summary, redacted_payload_json, expires_at
        )
        values
          ($1, $2, $3, $4, $5, 'pending', 'high', $6, 'codex-issue-005-proof', 'Approve migration', '{}'::jsonb, now() + interval '15 minutes'),
          ($1, $2, $3, $4, $5, 'pending', 'medium', $6, 'codex-issue-005-proof', 'Deny relay config patch', '{}'::jsonb, now() + interval '15 minutes'),
          ($1, $2, $3, $4, $5, 'pending', 'critical', $6, 'codex-issue-005-proof', 'Expired deploy', '{}'::jsonb, now() - interval '1 minute'),
          ($1, $2, $3, $4, $5, 'pending', 'low', $6, 'codex-issue-005-proof', 'Unauthorized probe', '{}'::jsonb, now() + interval '15 minutes')
        returning id, action_summary
      `,
      [organizationId, projectId, agentToolId, installationId, sessionId, routeId]
    );

    return {
      approvalRequestIds: {
        expired: requestRows.find((row) => row.action_summary === "Expired deploy").id,
        pendingApprove: requestRows.find((row) => row.action_summary === "Approve migration").id,
        pendingDeny: requestRows.find((row) => row.action_summary === "Deny relay config patch").id,
        unauthorizedProbe: requestRows.find((row) => row.action_summary === "Unauthorized probe").id
      },
      organizationId,
      otherOrganizationId,
      users: {
        admin,
        otherOrgAdmin,
        viewer
      }
    };
  });
}

async function buildNext(databaseUrl) {
  await execFileAsync("npx", ["next", "build", "apps/web"], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      HOOKWIRE_DATABASE_ROLE: "hookwire_app",
      HOOKWIRE_INTERNAL_API_SECRET: internalApiSecret
    },
    maxBuffer: 1024 * 1024 * 20
  });
}

function startNext(databaseUrl) {
  const child = spawn(
    "npx",
    ["next", "start", "apps/web", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        HOOKWIRE_DATABASE_ROLE: "hookwire_app",
        HOOKWIRE_INTERNAL_API_SECRET: internalApiSecret
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  return { child, logs };
}

async function waitForServer(logs) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < 20_000) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Next server did not start: ${lastError?.message ?? "unknown"}\n${logs.join("")}`);
}

async function postDecision(path, graph, body = {}, overrides = {}) {
  const organizationId = overrides.organizationId ?? graph.organizationId;
  const userId = overrides.userId ?? graph.users.admin;
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-hookwire-identity-signature": signIdentity(organizationId, userId),
      "x-hookwire-organization-id": organizationId,
      "x-hookwire-user-id": userId
    },
    method: "POST"
  });
  const json = await response.json();

  return { body: json, status: response.status };
}

function signIdentity(organizationId, userId) {
  return createHmac("sha256", internalApiSecret).update(`${organizationId}:${userId}`).digest("hex");
}

async function queryProofRows(databaseUrl, graph) {
  return withClient(databaseUrl, async (client) => {
    const requestIds = Object.values(graph.approvalRequestIds);
    const { rows: approvalRequests } = await client.query(
      `
        select id, status, action_summary
        from approval_requests
        where id = any($1::uuid[])
        order by action_summary
      `,
      [requestIds]
    );
    const { rows: approvalDecisions } = await client.query(
      `
        select approval_request_id, user_id, source, decision, scope, reason
        from approval_decisions
        where approval_request_id = any($1::uuid[])
        order by created_at
      `,
      [requestIds]
    );
    const { rows: auditEvents } = await client.query(
      `
        select actor_user_id, event_type, entity_id, metadata_json
        from audit_events
        where entity_type = 'approval_request' and entity_id = any($1::uuid[])
        order by created_at
      `,
      [requestIds]
    );

    return {
      approval_decisions: approvalDecisions,
      approval_requests: approvalRequests,
      audit_events: auditEvents
    };
  });
}

async function main() {
  const { containerId, databaseUrl } = await startPostgres();
  let nextServer;

  try {
    await resetDatabase(databaseUrl);
    await migrate(databaseUrl);
    const graph = await seedDecisionApiGraph(databaseUrl);
    await buildNext(databaseUrl);
    nextServer = startNext(databaseUrl);
    await waitForServer(nextServer.logs);

    const apiResults = {
      approve: await postDecision(
        `/api/approvals/${graph.approvalRequestIds.pendingApprove}/approve`,
        graph,
        { scope: "once" }
      ),
      repeatApprove: await postDecision(`/api/approvals/${graph.approvalRequestIds.pendingApprove}/approve`, graph),
      deny: await postDecision(
        `/api/approvals/${graph.approvalRequestIds.pendingDeny}/deny`,
        graph,
        { reason: "Touches protected relay routing", scope: "session" }
      ),
      repeatDeny: await postDecision(
        `/api/approvals/${graph.approvalRequestIds.pendingDeny}/deny`,
        graph,
        { reason: "Trying again" }
      ),
      expired: await postDecision(`/api/approvals/${graph.approvalRequestIds.expired}/approve`, graph),
      unauthorized: await postDecision(
        `/api/approvals/${graph.approvalRequestIds.unauthorizedProbe}/approve`,
        graph,
        {},
        { userId: graph.users.viewer }
      ),
      wrongOrganizationUser: await postDecision(
        `/api/approvals/${graph.approvalRequestIds.unauthorizedProbe}/approve`,
        graph,
        {},
        { userId: graph.users.otherOrgAdmin }
      )
    };
    const queryRows = await queryProofRows(databaseUrl, graph);
    const output = {
      api_results: apiResults,
      database: queryRows,
      seeded_request_ids: graph.approvalRequestIds
    };

    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(JSON.stringify(output, null, 2));
  } finally {
    if (nextServer) {
      nextServer.child.kill("SIGTERM");
    }
    await docker(["stop", containerId]).catch(() => {});
  }
}

await main();
