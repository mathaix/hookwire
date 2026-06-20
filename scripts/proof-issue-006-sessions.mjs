import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import pg from "pg";
import { migrate, resetDatabase } from "../packages/db/src/migrate.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;
const outputPath = new URL("../docs/reviews/2026-06-20-issue-006-session-proof.json", import.meta.url);
const filtersScreenshotPath = new URL("../docs/reviews/2026-06-20-issue-006-session-filters.png", import.meta.url);
const detailScreenshotPath = new URL("../docs/reviews/2026-06-20-issue-006-session-detail.png", import.meta.url);
const port = 3026;
const baseUrl = `http://127.0.0.1:${port}`;
const knownSecret = "sk-live-super-secret";

async function docker(args) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function startPostgres() {
  const name = `hookwire-session-proof-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_session_proof",
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

  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${match[1]}/hookwire_session_proof`;
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

async function withTenantClient(databaseUrl, organizationId, callback) {
  return withClient(databaseUrl, async (client) => {
    await client.query("begin");
    try {
      await client.query('set local role "hookwire_app"');
      await client.query("select set_config('app.current_organization_id', $1, true)", [organizationId]);
      const result = await callback(client);
      await client.query("commit");

      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
  });
}

async function seedGraph(databaseUrl) {
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
        ('sam@acme.dev', 'Sam R.'),
        ('globex-owner@example.dev', 'Globex Owner')
      returning id, email
    `);
    const maya = userRows.find((row) => row.email === "maya@acme.dev").id;
    const sam = userRows.find((row) => row.email === "sam@acme.dev").id;
    const globexOwner = userRows.find((row) => row.email === "globex-owner@example.dev").id;

    await client.query(
      `
        insert into memberships (organization_id, user_id, role)
        values ($1, $2, 'admin'), ($1, $3, 'member'), ($4, $5, 'owner')
      `,
      [organizationId, maya, sam, otherOrganizationId, globexOwner]
    );

    const { rows: projectRows } = await client.query(
      `
        insert into projects (organization_id, name, slug, repo_provider, repo_owner, repo_name)
        values
          ($1, 'hookwire/web', 'hookwire-web', 'github', 'mathaix', 'hookwire'),
          ($1, 'infra/relay', 'infra-relay', 'github', 'mathaix', 'infra-relay'),
          ($2, 'globex/app', 'globex-app', 'github', 'globex', 'app')
        returning id, organization_id, slug
      `,
      [organizationId, otherOrganizationId]
    );
    const hookwireWeb = projectRows.find((row) => row.slug === "hookwire-web").id;
    const infraRelay = projectRows.find((row) => row.slug === "infra-relay").id;
    const globexApp = projectRows.find((row) => row.slug === "globex-app").id;

    const codex = await seedTool(client, organizationId, hookwireWeb, "codex", maya);
    const claude = await seedTool(client, organizationId, infraRelay, "claude", maya);
    const openclaw = await seedTool(client, organizationId, hookwireWeb, "openclaw", sam);
    const globex = await seedTool(client, otherOrganizationId, globexApp, "codex", globexOwner);

    const codexSession = await seedSession(client, {
      agentType: "codex",
      branch: "codex/issue-006-session-explorer",
      externalSessionId: "codex-7f31",
      installationId: codex.installationId,
      organizationId,
      projectId: hookwireWeb,
      startedAt: "2026-06-18T17:15:00.000Z",
      status: "active",
      toolId: codex.toolId,
      userId: maya
    });
    const claudeSession = await seedSession(client, {
      agentType: "claude",
      branch: "main",
      externalSessionId: "claude-a88c",
      installationId: claude.installationId,
      organizationId,
      projectId: infraRelay,
      startedAt: "2026-06-18T16:50:00.000Z",
      status: "idle",
      toolId: claude.toolId,
      userId: maya
    });
    const openclawSession = await seedSession(client, {
      agentType: "openclaw",
      branch: "adapter-probe",
      externalSessionId: "openclaw-19b2",
      installationId: openclaw.installationId,
      organizationId,
      projectId: hookwireWeb,
      startedAt: "2026-06-12T10:00:00.000Z",
      status: "ended",
      toolId: openclaw.toolId,
      userId: sam
    });
    const otherTenantSession = await seedSession(client, {
      agentType: "codex",
      branch: "main",
      externalSessionId: "globex-codex",
      installationId: globex.installationId,
      organizationId: otherOrganizationId,
      projectId: globexApp,
      startedAt: "2026-06-18T17:10:00.000Z",
      status: "active",
      toolId: globex.toolId,
      userId: globexOwner
    });

    const { rows: routeRows } = await client.query(
      `
        insert into routes (organization_id, name, approvals_required, timeout_seconds)
        values ($1, 'Web inbox', 1, 900), ($2, 'Globex inbox', 1, 900)
        returning id, organization_id
      `,
      [organizationId, otherOrganizationId]
    );
    const routeId = routeRows.find((row) => row.organization_id === organizationId).id;
    const otherRouteId = routeRows.find((row) => row.organization_id === otherOrganizationId).id;

    const { rows: eventRows } = await client.query(
      `
        insert into hook_events (
          organization_id, project_id, agent_session_id, event_type, tool_name, operation, risk_level,
          payload_redacted, created_at
        )
        values
          ($1, $2, $3, 'tool.invoked', 'shell', 'npm run db:migrate', 'high', $4::jsonb, '2026-06-18T17:18:00.000Z'),
          ($1, $2, $3, 'approval.requested', 'approval', 'approval request created', 'high', $5::jsonb, '2026-06-18T17:19:00.000Z'),
          ($1, $6, $7, 'tool.invoked', 'write_file', 'Patch relay config', 'medium', '{"path":".hookwire/relay.json"}'::jsonb, '2026-06-18T16:55:00.000Z'),
          ($1, $2, $8, 'tool.invoked', 'read_file', 'Read adapter manifest', 'low', '{"path":"adapter.json"}'::jsonb, '2026-06-12T10:02:00.000Z'),
          ($9, $10, $11, 'tool.invoked', 'shell', 'secret deploy', 'critical', '{"tenant":"globex"}'::jsonb, '2026-06-18T17:11:00.000Z')
        returning id, agent_session_id, operation
      `,
      [
        organizationId,
        hookwireWeb,
        codexSession,
        JSON.stringify({
          command: 'curl -H "Authorization: Bearer [redacted]" https://api.example.test',
          env: { DATABASE_URL: "postgres://hookwire:[redacted]@localhost:5432/hookwire" }
        }),
        JSON.stringify({ approvalId: "APR-1042", token: "[redacted]" }),
        infraRelay,
        claudeSession,
        openclawSession,
        otherOrganizationId,
        globexApp,
        otherTenantSession
      ]
    );
    const codexApprovalEvent = eventRows.find(
      (row) => row.agent_session_id === codexSession && row.operation === "npm run db:migrate"
    ).id;

    const { rows: approvalRows } = await client.query(
      `
        insert into approval_requests (
          organization_id, project_id, agent_tool_id, agent_installation_id, agent_session_id, hook_event_id,
          status, risk_level, route_id, requested_by_agent, action_summary, redacted_payload_json, expires_at,
          created_at
        )
        values
          ($1, $2, $3, $4, $5, $6, 'approved', 'high', $7, 'codex-7f31', 'Apply migration and write project settings', $8::jsonb, '2026-06-18T17:45:00.000Z', '2026-06-18T17:19:30.000Z'),
          ($1, $9, $10, $11, $12, null, 'pending', 'medium', $7, 'claude-a88c', 'Patch local relay config', '{"diff":["route: slack-oncall"]}'::jsonb, '2026-06-18T17:50:00.000Z', '2026-06-18T16:56:00.000Z'),
          ($13, $14, $15, $16, $17, null, 'pending', 'critical', $18, 'globex-codex', 'Globex deploy', '{}'::jsonb, '2026-06-18T17:50:00.000Z', '2026-06-18T17:12:00.000Z')
        returning id, agent_session_id
      `,
      [
        organizationId,
        hookwireWeb,
        codex.toolId,
        codex.installationId,
        codexSession,
        codexApprovalEvent,
        routeId,
        JSON.stringify({ command: "npm run db:migrate", token: "[redacted]" }),
        infraRelay,
        claude.toolId,
        claude.installationId,
        claudeSession,
        otherOrganizationId,
        globexApp,
        globex.toolId,
        globex.installationId,
        otherTenantSession,
        otherRouteId
      ]
    );
    const codexApproval = approvalRows.find((row) => row.agent_session_id === codexSession).id;

    await client.query(
      `
        insert into approval_decisions (approval_request_id, organization_id, user_id, source, decision, scope, reason, created_at)
        values ($1, $2, $3, 'web', 'approved', 'once', 'Reviewed migration', '2026-06-18T17:20:00.000Z')
      `,
      [codexApproval, organizationId, maya]
    );

    return {
      organizationId,
      otherOrganizationId,
      projectIds: {
        hookwireWeb,
        infraRelay
      },
      sessionIds: {
        claude: claudeSession,
        codex: codexSession,
        openclaw: openclawSession,
        otherTenant: otherTenantSession
      }
    };
  });
}

async function seedTool(client, organizationId, projectId, agentType, userId) {
  const { rows: toolRows } = await client.query(
    `
      insert into agent_tools (organization_id, project_id, agent_type, display_name, created_by_user_id)
      values ($1, $2, $3, $4, $5)
      returning id
    `,
    [organizationId, projectId, agentType, agentLabel(agentType), userId]
  );
  const { rows: installationRows } = await client.query(
    `
      insert into agent_installations (
        organization_id, project_id, agent_tool_id, agent_type, registered_by_user_id, owner_user_id,
        machine_fingerprint
      )
      values ($1, $2, $3, $4, $5, $5, $6)
      returning id
    `,
    [organizationId, projectId, toolRows[0].id, agentType, userId, `${agentType}-${projectId}-proof-machine`]
  );

  return { installationId: installationRows[0].id, toolId: toolRows[0].id };
}

async function seedSession(client, input) {
  const { rows } = await client.query(
    `
      insert into agent_sessions (
        organization_id, project_id, agent_tool_id, agent_installation_id, agent_type,
        external_session_id, started_by_user_id, claimed_by_user_id, branch, commit_sha,
        status, started_at, last_seen_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $7, $8, 'abc123', $9, $10, $10::timestamptz + interval '9 minutes')
      returning id
    `,
    [
      input.organizationId,
      input.projectId,
      input.toolId,
      input.installationId,
      input.agentType,
      input.externalSessionId,
      input.userId,
      input.branch,
      input.status,
      input.startedAt
    ]
  );

  return rows[0].id;
}

function agentLabel(agentType) {
  return agentType === "claude" ? "Claude Code" : agentType === "openclaw" ? "OpenClaw" : "Codex";
}

async function queryProof(databaseUrl, graph) {
  const acme = await withTenantClient(databaseUrl, graph.organizationId, async (client) => {
    const allSessions = await querySessionRollup(client, graph.organizationId, {});
    const codexHigh = await querySessionRollup(client, graph.organizationId, {
      agentType: "codex",
      projectId: graph.projectIds.hookwireWeb,
      risk: "high",
      status: "active",
      today: true
    });
    const detail = await querySessionDetail(client, graph.organizationId, graph.sessionIds.codex);
    const globexLeakProbe = await querySessionDetail(client, graph.organizationId, graph.sessionIds.otherTenant);
    const { rows: globexDirectRlsProbe } = await client.query(
      "select external_session_id from agent_sessions where id = $1",
      [graph.sessionIds.otherTenant]
    );

    return { allSessions, codexHigh, detail, globexDirectRlsProbe, globexLeakProbe };
  });
  const globex = await withTenantClient(databaseUrl, graph.otherOrganizationId, async (client) =>
    querySessionRollup(client, graph.otherOrganizationId, {})
  );

  return { acme, globex };
}

async function querySessionRollup(client, organizationId, filters) {
  const { rows } = await client.query(
    `
      with rollup as (
        select
          s.id,
          s.external_session_id,
          s.agent_type,
          s.status,
          p.name as project_name,
          count(distinct he.id) as hook_event_count,
          count(distinct ar.id) as approval_request_count,
          count(distinct ar.id) filter (where ar.status = 'pending') as pending_approval_count,
          count(distinct ad.id) as decision_count,
          case greatest(
            coalesce(max(case he.risk_level when 'critical' then 5 when 'high' then 4 when 'medium' then 3 when 'low' then 2 else 1 end), 1),
            coalesce(max(case ar.risk_level when 'critical' then 5 when 'high' then 4 when 'medium' then 3 when 'low' then 2 else 1 end), 1)
          )
            when 5 then 'critical'
            when 4 then 'high'
            when 3 then 'medium'
            when 2 then 'low'
            else 'unknown'
          end as highest_risk,
          s.started_at
        from agent_sessions s
        join projects p on p.organization_id = s.organization_id and p.id = s.project_id
        left join hook_events he on he.organization_id = s.organization_id and he.agent_session_id = s.id
        left join approval_requests ar on ar.organization_id = s.organization_id and ar.agent_session_id = s.id
        left join approval_decisions ad on ad.organization_id = s.organization_id and ad.approval_request_id = ar.id
        where s.organization_id = $1
          and ($2::uuid is null or s.project_id = $2::uuid)
          and ($3::text is null or s.agent_type = $3::text)
          and ($4::text is null or s.status = $4::text)
          and ($5::boolean is false or s.started_at >= '2026-06-18T00:00:00.000Z'::timestamptz)
          and ($5::boolean is false or s.started_at < '2026-06-19T00:00:00.000Z'::timestamptz)
        group by s.id, s.external_session_id, s.agent_type, s.status, p.name, s.started_at
      )
      select *
      from rollup
      where ($6::text is null or highest_risk = $6::text)
      order by external_session_id
    `,
    [
      organizationId,
      filters.projectId ?? null,
      filters.agentType ?? null,
      filters.status ?? null,
      Boolean(filters.today),
      filters.risk ?? null
    ]
  );

  return rows;
}

async function querySessionDetail(client, organizationId, sessionId) {
  const { rows: sessions } = await client.query(
    `
      select id, external_session_id, agent_type, status
      from agent_sessions
      where organization_id = $1 and id = $2
    `,
    [organizationId, sessionId]
  );
  if (!sessions[0]) {
    return null;
  }

  const { rows: hookEvents } = await client.query(
    `
      select event_type, tool_name, operation, risk_level, payload_redacted
      from hook_events
      where organization_id = $1 and agent_session_id = $2
      order by created_at
    `,
    [organizationId, sessionId]
  );
  const { rows: approvalRequests } = await client.query(
    `
      select id, status, risk_level, action_summary
      from approval_requests
      where organization_id = $1 and agent_session_id = $2
      order by created_at
    `,
    [organizationId, sessionId]
  );
  const { rows: approvalDecisions } = await client.query(
    `
      select ad.approval_request_id, ad.decision, ad.scope, ad.source, ad.reason
      from approval_decisions ad
      join approval_requests ar on ar.organization_id = ad.organization_id and ar.id = ad.approval_request_id
      where ad.organization_id = $1 and ar.agent_session_id = $2
      order by ad.created_at
    `,
    [organizationId, sessionId]
  );

  return { approvalDecisions, approvalRequests, hookEvents, session: sessions[0] };
}

async function buildNext() {
  await execFileAsync("npx", ["next", "build", "apps/web"], {
    maxBuffer: 1024 * 1024 * 20
  });
}

function startNext() {
  const child = spawn("npx", ["next", "start", "apps/web", "--hostname", "127.0.0.1", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"]
  });
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
      const response = await fetch(`${baseUrl}/sessions`);
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

async function captureScreenshots() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const consoleMessages = [];
  page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));

  await page.goto(`${baseUrl}/sessions`);
  const filters = page.getByRole("region", { name: "Session filters" });
  await filters.getByLabel("Project").selectOption("project-hookwire-web");
  await filters.getByLabel("Agent").selectOption("codex");
  await filters.getByLabel("Status").selectOption("active");
  await filters.getByLabel("Risk").selectOption("high");
  await filters.getByLabel("Date").selectOption("today");
  await page.screenshot({ fullPage: true, path: fileURLToPath(filtersScreenshotPath) });

  await page.goto(`${baseUrl}/sessions?session=codex-7f31`);
  const bodyText = await page.locator("body").innerText();
  if (bodyText.includes(knownSecret) || bodyText.includes("local-dev-password")) {
    throw new Error("Session detail rendered an unredacted secret fixture.");
  }
  await page.screenshot({ fullPage: true, path: fileURLToPath(detailScreenshotPath) });
  await browser.close();

  return {
    consoleMessages,
    detailScreenshot: fileURLToPath(detailScreenshotPath),
    filtersScreenshot: fileURLToPath(filtersScreenshotPath),
    redactionChecked: true
  };
}

async function main() {
  const postgres = await startPostgres();
  let nextServer;
  try {
    await resetDatabase(postgres.databaseUrl);
    await migrate(postgres.databaseUrl);
    const graph = await seedGraph(postgres.databaseUrl);
    const queryOutput = await queryProof(postgres.databaseUrl, graph);

    await buildNext();
    nextServer = startNext();
    await waitForServer(nextServer.logs);
    const screenshotProof = await captureScreenshots();

    const proof = {
      issue: "006-session-explorer",
      generatedAt: new Date().toISOString(),
      seededSessionIds: graph.sessionIds,
      projectIds: graph.projectIds,
      queryProof: queryOutput,
      screenshotProof
    };
    const proofJson = JSON.stringify(proof, null, 2);
    if (proofJson.includes(knownSecret) || proofJson.includes("local-dev-password")) {
      throw new Error("Issue 006 proof artifact contains an unredacted secret fixture.");
    }
    await writeFile(outputPath, `${proofJson}\n`);
    console.log(JSON.stringify({ ok: true, outputPath: fileURLToPath(outputPath), seededSessionIds: graph.sessionIds }));
  } finally {
    if (nextServer) {
      nextServer.child.kill();
    }
    await docker(["stop", postgres.containerId]).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
