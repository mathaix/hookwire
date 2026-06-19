import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import pg from "pg";
import { migrate, resetDatabase } from "../packages/db/src/migrate.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;
const outputPath = new URL("../docs/reviews/2026-06-19-issue-004-db-query-output.json", import.meta.url);

async function docker(args) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function mappedPort(containerId) {
  const { stdout } = await docker(["port", containerId, "5432/tcp"]);
  const match = stdout.trim().match(/:(\d+)$/);
  if (!match) {
    throw new Error(`Could not parse Docker port output: ${stdout}`);
  }
  return match[1];
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

async function startPostgres() {
  const name = `hookwire-proof-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_proof",
    "-p",
    "127.0.0.1::5432",
    "postgres:16"
  ]);
  const containerId = stdout.trim();
  const port = await mappedPort(containerId);
  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${port}/hookwire_proof`;
  await waitForPostgres(databaseUrl);

  return { containerId, databaseUrl };
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

async function createBaseGraph(client) {
  const { rows: orgRows } = await client.query(`
    insert into organizations (name, slug)
    values ('Acme Engineering', 'acme-engineering')
    returning id
  `);
  const organizationId = orgRows[0].id;

  const { rows: userRows } = await client.query(`
    insert into users (email, name)
    values ('maya@acme.dev', 'Maya W.')
    returning id
  `);
  const userId = userRows[0].id;

  await client.query("insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')", [
    organizationId,
    userId
  ]);

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
    [organizationId, projectId, userId]
  );
  const agentToolId = toolRows[0].id;

  const { rows: installationRows } = await client.query(
    `
      insert into agent_installations (
        organization_id, project_id, agent_tool_id, agent_type, registered_by_user_id, owner_user_id,
        machine_fingerprint
      )
      values ($1, $2, $3, 'codex', $4, $4, 'issue-004-proof-machine')
      returning id
    `,
    [organizationId, projectId, agentToolId, userId]
  );
  const installationId = installationRows[0].id;

  const { rows: sessionRows } = await client.query(
    `
      insert into agent_sessions (
        organization_id, project_id, agent_tool_id, agent_installation_id, agent_type, external_session_id,
        started_by_user_id
      )
      values ($1, $2, $3, $4, 'codex', 'codex-7f31', $5)
      returning id
    `,
    [organizationId, projectId, agentToolId, installationId, userId]
  );

  return {
    agentInstallationId: installationId,
    agentSessionId: sessionRows[0].id,
    agentToolId,
    organizationId,
    projectId,
    routeId,
    userId
  };
}

async function seedApprovalRequests(client, graph) {
  const { rows } = await client.query(
    `
      insert into approval_requests (
        organization_id, project_id, agent_tool_id, agent_installation_id, agent_session_id, status,
        risk_level, route_id, requested_by_agent, action_summary, redacted_payload_json, expires_at
      )
      values
        ($1, $2, $3, $4, $5, 'pending', 'high', $6, 'codex-7f31', 'APR-1042 Apply migration and write project settings', '{"command":"npm run db:migrate","token":"[redacted]"}'::jsonb, now() + interval '15 minutes'),
        ($1, $2, $3, $4, $5, 'pending', 'medium', $6, 'codex-7f31', 'APR-1041 Patch local relay config', '{"path":".hookwire/relay.json"}'::jsonb, now() + interval '15 minutes')
      returning id, action_summary
    `,
    [
      graph.organizationId,
      graph.projectId,
      graph.agentToolId,
      graph.agentInstallationId,
      graph.agentSessionId,
      graph.routeId
    ]
  );

  return {
    approvedRequest: rows.find((row) => row.action_summary.startsWith("APR-1042")),
    deniedRequest: rows.find((row) => row.action_summary.startsWith("APR-1041"))
  };
}

async function recordDecision(client, graph, approvalRequest, decision, reason = null) {
  await client.query("update approval_requests set status = $1, updated_at = now() where id = $2", [
    decision,
    approvalRequest.id
  ]);

  const { rows } = await client.query(
    `
      insert into approval_decisions (approval_request_id, organization_id, user_id, source, decision, scope, reason)
      values ($1, $2, $3, 'web', $4, 'once', $5)
      returning id
    `,
    [approvalRequest.id, graph.organizationId, graph.userId, decision, reason]
  );

  await client.query(
    `
      insert into audit_events (
        organization_id, project_id, actor_type, actor_user_id, event_type, entity_type, entity_id, metadata_json
      )
      values ($1, $2, 'user', $3, $4, 'approval_request', $5, $6)
    `,
    [
      graph.organizationId,
      graph.projectId,
      graph.userId,
      `approval.${decision}`,
      approvalRequest.id,
      JSON.stringify({ decisionId: rows[0].id, routeId: graph.routeId, reasonRequired: Boolean(reason) })
    ]
  );
}

async function queryProofRows(client, organizationId) {
  const { rows: approvalRequests } = await client.query(
    `
      select id, status, risk_level, requested_by_agent, action_summary, redacted_payload_json
      from approval_requests
      where organization_id = $1
      order by action_summary desc
    `,
    [organizationId]
  );
  const { rows: approvalDecisions } = await client.query(
    `
      select approval_request_id, decision, scope, source, reason
      from approval_decisions
      where organization_id = $1
      order by created_at asc
    `,
    [organizationId]
  );
  const { rows: auditEvents } = await client.query(
    `
      select event_type, entity_type, entity_id, metadata_json
      from audit_events
      where organization_id = $1 and entity_type = 'approval_request'
      order by created_at asc
    `,
    [organizationId]
  );

  return { approvalRequests, approvalDecisions, auditEvents };
}

async function main() {
  const { containerId, databaseUrl } = await startPostgres();

  try {
    await resetDatabase(databaseUrl);
    await migrate(databaseUrl);

    const output = await withClient(databaseUrl, async (client) => {
      await client.query("begin");
      const graph = await createBaseGraph(client);
      const { approvedRequest, deniedRequest } = await seedApprovalRequests(client, graph);

      await recordDecision(client, graph, approvedRequest, "approved");
      await recordDecision(client, graph, deniedRequest, "denied", "Relay config patch touches protected routing");

      const { approvalRequests, approvalDecisions, auditEvents } = await queryProofRows(client, graph.organizationId);
      await client.query("commit");

      return {
        seeded_request_ids: {
          approved: approvedRequest.id,
          denied: deniedRequest.id
        },
        approval_requests: approvalRequests,
        approval_decisions: approvalDecisions,
        audit_events: auditEvents
      };
    });

    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await docker(["stop", containerId]).catch(() => {});
  }
}

await main();
