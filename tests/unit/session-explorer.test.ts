import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import {
  agentTypeLabel,
  createSessionExplorer,
  getSessionExplorerQuerySnapshot,
  getSessionMetrics,
  highestRisk,
  matchesSessionFilters,
  normalizeSessionFilters,
  redactSessionPayload
} from "../../apps/web/app/sessions/domain";
import { getSessionDetail, listSessions } from "../../apps/web/app/sessions/session-service";
import { migrate, resetDatabase } from "../../packages/db/src/migrate.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;
const knownSecret = "sk-live-super-secret";

async function docker(args: string[]) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function startPostgres() {
  const name = `hookwire-sessions-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_session_test",
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

  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${match[1]}/hookwire_session_test`;
  await waitForPostgres(databaseUrl);

  return { containerId, databaseUrl };
}

async function waitForPostgres(databaseUrl: string) {
  const startedAt = Date.now();
  let lastError: unknown;

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

async function withClient<T>(databaseUrl: string, callback: (client: pg.Client) => Promise<T>) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function querySessionByIdThroughTenantRole(databaseUrl: string, organizationId: string, sessionId: string) {
  return withClient(databaseUrl, async (client) => {
    await client.query("begin");
    try {
      await client.query('set local role "hookwire_app"');
      await client.query("select set_config('app.current_organization_id', $1, true)", [organizationId]);
      const { rows } = await client.query("select external_session_id from agent_sessions where id = $1", [sessionId]);
      await client.query("commit");

      return rows;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
  });
}

type SeededSessionGraph = {
  organizationId: string;
  otherOrganizationId: string;
  projectIds: {
    hookwireWeb: string;
    infraRelay: string;
  };
  sessionIds: {
    claude: string;
    codex: string;
    openclaw: string;
    otherTenant: string;
  };
};

async function seedSessionGraph(databaseUrl: string): Promise<SeededSessionGraph> {
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

    async function seedTool(projectId: string, orgId: string, agentType: string, userId: string) {
      const { rows: toolRows } = await client.query(
        `
          insert into agent_tools (organization_id, project_id, agent_type, display_name, created_by_user_id)
          values ($1, $2, $3, $4, $5)
          returning id
        `,
        [orgId, projectId, agentType, agentLabel(agentType), userId]
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
        [orgId, projectId, toolRows[0].id, agentType, userId, `${agentType}-${projectId}-machine`]
      );

      return { installationId: installationRows[0].id, toolId: toolRows[0].id };
    }

    const codex = await seedTool(hookwireWeb, organizationId, "codex", maya);
    const claude = await seedTool(infraRelay, organizationId, "claude", maya);
    const openclaw = await seedTool(hookwireWeb, organizationId, "openclaw", sam);
    const globex = await seedTool(globexApp, otherOrganizationId, "codex", globexOwner);

    async function seedSession(input: {
      agentType: "claude" | "codex" | "openclaw";
      branch: string;
      externalSessionId: string;
      installationId: string;
      orgId: string;
      projectId: string;
      startedAt: string;
      status: "active" | "idle" | "ended" | "errored";
      toolId: string;
      userId: string;
    }) {
      const { rows: sessionRows } = await client.query(
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
          input.orgId,
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

      return sessionRows[0].id;
    }

    const codexSession = await seedSession({
      agentType: "codex",
      branch: "codex/issue-006-session-explorer",
      externalSessionId: "codex-7f31",
      installationId: codex.installationId,
      orgId: organizationId,
      projectId: hookwireWeb,
      startedAt: "2026-06-18T17:15:00.000Z",
      status: "active",
      toolId: codex.toolId,
      userId: maya
    });
    const claudeSession = await seedSession({
      agentType: "claude",
      branch: "main",
      externalSessionId: "claude-a88c",
      installationId: claude.installationId,
      orgId: organizationId,
      projectId: infraRelay,
      startedAt: "2026-06-18T16:50:00.000Z",
      status: "idle",
      toolId: claude.toolId,
      userId: maya
    });
    const openclawSession = await seedSession({
      agentType: "openclaw",
      branch: "adapter-probe",
      externalSessionId: "openclaw-19b2",
      installationId: openclaw.installationId,
      orgId: organizationId,
      projectId: hookwireWeb,
      startedAt: "2026-06-12T10:00:00.000Z",
      status: "ended",
      toolId: openclaw.toolId,
      userId: sam
    });
    const otherTenantSession = await seedSession({
      agentType: "codex",
      branch: "main",
      externalSessionId: "globex-codex",
      installationId: globex.installationId,
      orgId: otherOrganizationId,
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
          ($1, $2, $3, 'approval.requested', 'shell', 'npm run db:migrate', 'high', $5::jsonb, '2026-06-18T17:19:00.000Z'),
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
          command: `curl -H "Authorization: Bearer ${knownSecret}" https://api.example.test`,
          env: { DATABASE_URL: "postgres://hookwire:local-dev-password@localhost:5432/hookwire" }
        }),
        JSON.stringify({ approvalId: "pending migration", token: knownSecret }),
        infraRelay,
        claudeSession,
        openclawSession,
        otherOrganizationId,
        globexApp,
        otherTenantSession
      ]
    );
    const codexApprovalEvent = eventRows.find((row) => row.agent_session_id === codexSession && row.operation === "npm run db:migrate").id;

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
        returning id, agent_session_id, action_summary
      `,
      [
        organizationId,
        hookwireWeb,
        codex.toolId,
        codex.installationId,
        codexSession,
        codexApprovalEvent,
        routeId,
        JSON.stringify({ command: "npm run db:migrate", token: knownSecret }),
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

function agentLabel(agentType: string) {
  return agentType === "claude" ? "Claude Code" : agentType === "openclaw" ? "OpenClaw" : "Codex";
}

describe("session explorer domain", () => {
  it("filters sessions by project, agent type, status, risk, and date", () => {
    const explorer = createSessionExplorer({
      filters: {
        agentType: "codex",
        date: "today",
        projectId: "project-hookwire-web",
        risk: "high",
        status: "active"
      }
    });

    expect(explorer.sessions.map((session) => session.externalSessionId)).toEqual(["codex-7f31"]);
    expect(getSessionMetrics(explorer.sessions)).toMatchObject({
      active: 1,
      agents: { claude: 0, codex: 1, openclaw: 0 },
      pendingApprovals: 0,
      total: 1
    });
  });

  it("returns linked detail rows and a query snapshot for a selected session", () => {
    const explorer = createSessionExplorer({ selectedSessionId: "codex-7f31" });

    expect(explorer.detail).toMatchObject({
      externalSessionId: "codex-7f31",
      agentType: "codex"
    });
    expect(explorer.detail?.approvalRequests).toEqual(
      expect.arrayContaining([expect.objectContaining({ actionSummary: "Apply migration and write project settings" })])
    );
    expect(explorer.detail?.decisions).toEqual(
      expect.arrayContaining([expect.objectContaining({ decision: "approved", reason: "Reviewed migration" })])
    );
    expect(explorer.detail?.hookEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ operation: "npm run db:migrate" })])
    );

    const snapshot = getSessionExplorerQuerySnapshot(explorer, "codex-7f31");
    expect(snapshot.agent_sessions).toEqual([expect.objectContaining({ external_session_id: "codex-7f31" })]);
    expect(snapshot.hook_events).toHaveLength(2);
    expect(snapshot.approval_requests).toHaveLength(1);
    expect(snapshot.approval_decisions).toHaveLength(1);
  });

  it("redacts sensitive session event payloads before rendering", () => {
    const redacted = redactSessionPayload({
      command: `curl -H "Authorization: Bearer ${knownSecret}" https://api.example.test`,
      databaseUrl: "postgres://hookwire:local-dev-password@localhost:5432/hookwire",
      githubToken: "ghp_1234567890abcdef",
      nested: {
        apiKey: knownSecret
      }
    });
    const rendered = JSON.stringify(redacted);

    expect(rendered).not.toContain(knownSecret);
    expect(rendered).not.toContain("local-dev-password");
    expect(rendered).not.toContain("ghp_1234567890abcdef");
    expect(rendered).toContain("[redacted]");
  });

  it("covers risk, label, date-range, and empty snapshot helper branches", () => {
    const explorer = createSessionExplorer();

    expect(agentTypeLabel("claude")).toBe("Claude Code");
    expect(agentTypeLabel("openclaw")).toBe("OpenClaw");
    expect(agentTypeLabel("codex")).toBe("Codex");
    expect(highestRisk(["unknown", "low", "medium", "critical", "high"])).toBe("critical");
    expect(createSessionExplorer({ filters: { date: "last7d" } }).sessions.map((session) => session.externalSessionId).sort()).toEqual([
      "claude-a88c",
      "codex-7f31",
      "openclaw-19b2"
    ]);
    expect(getSessionExplorerQuerySnapshot(explorer, "missing-session")).toEqual({
      agent_sessions: [],
      approval_decisions: [],
      approval_requests: [],
      hook_events: []
    });

    const codex = explorer.sessions.find((session) => session.externalSessionId === "codex-7f31");
    expect(codex).toBeDefined();
    expect(
      matchesSessionFilters(codex!, normalizeSessionFilters({ projectId: "project-infra-relay" }))
    ).toBe(false);
    expect(matchesSessionFilters(codex!, normalizeSessionFilters({ agentType: "claude" }))).toBe(false);
    expect(matchesSessionFilters(codex!, normalizeSessionFilters({ status: "idle" }))).toBe(false);
    expect(matchesSessionFilters(codex!, normalizeSessionFilters({ risk: "medium" }))).toBe(false);
    expect(
      matchesSessionFilters(codex!, normalizeSessionFilters({ date: "today" }), "2026-06-19T18:00:00.000Z")
    ).toBe(false);
  });
});

describe("session explorer database service", () => {
  let containerId: string;
  let databaseUrl: string;
  let graph: SeededSessionGraph;

  beforeAll(async () => {
    const postgres = await startPostgres();
    containerId = postgres.containerId;
    databaseUrl = postgres.databaseUrl;
    process.env.HOOKWIRE_DATABASE_ROLE = "hookwire_app";
  }, 30_000);

  beforeEach(async () => {
    await resetDatabase(databaseUrl);
    await migrate(databaseUrl);
    graph = await seedSessionGraph(databaseUrl);
  });

  afterAll(async () => {
    if (containerId) {
      await docker(["stop", containerId]).catch(() => {});
    }
  });

  it("lists Claude, Codex, and OpenClaw sessions with project, status, risk, and summary metrics", async () => {
    const result = await listSessions({
      databaseUrl,
      filters: {},
      organizationId: graph.organizationId
    });

    expect(result.sessions.map((session) => session.agentType).sort()).toEqual(["claude", "codex", "openclaw"]);
    expect(result.sessions.map((session) => session.externalSessionId)).toContain("codex-7f31");
    expect(result.metrics).toMatchObject({
      agents: { claude: 1, codex: 1, openclaw: 1 },
      pendingApprovals: 1,
      total: 3
    });
    expect(result.sessions.find((session) => session.externalSessionId === "codex-7f31")).toMatchObject({
      approvalRequestCount: 1,
      decisionCount: 1,
      highestRisk: "high",
      hookEventCount: 2,
      projectName: "hookwire/web"
    });
  });

  it("filters by project, agent type, status, risk, and date", async () => {
    const project = await listSessions({
      databaseUrl,
      filters: { projectId: graph.projectIds.hookwireWeb },
      organizationId: graph.organizationId
    });
    const agent = await listSessions({
      databaseUrl,
      filters: { agentType: "claude" },
      organizationId: graph.organizationId
    });
    const status = await listSessions({
      databaseUrl,
      filters: { status: "ended" },
      organizationId: graph.organizationId
    });
    const risk = await listSessions({
      databaseUrl,
      filters: { risk: "medium" },
      organizationId: graph.organizationId
    });
    const date = await listSessions({
      databaseUrl,
      filters: { date: "today" },
      organizationId: graph.organizationId,
      now: "2026-06-18T18:00:00.000Z"
    });

    expect(project.sessions.map((session) => session.externalSessionId).sort()).toEqual(["codex-7f31", "openclaw-19b2"]);
    expect(agent.sessions.map((session) => session.externalSessionId)).toEqual(["claude-a88c"]);
    expect(status.sessions.map((session) => session.externalSessionId)).toEqual(["openclaw-19b2"]);
    expect(risk.sessions.map((session) => session.externalSessionId)).toEqual(["claude-a88c"]);
    expect(date.sessions.map((session) => session.externalSessionId).sort()).toEqual(["claude-a88c", "codex-7f31"]);

    const lastSevenDays = await listSessions({
      databaseUrl,
      filters: { date: "last7d" },
      organizationId: graph.organizationId,
      now: "2026-06-18T18:00:00.000Z"
    });
    expect(lastSevenDays.sessions.map((session) => session.externalSessionId).sort()).toEqual([
      "claude-a88c",
      "codex-7f31",
      "openclaw-19b2"
    ]);
  });

  it("returns a session detail with linked hook events, approval requests, and decisions", async () => {
    const detail = await getSessionDetail({
      databaseUrl,
      organizationId: graph.organizationId,
      sessionId: graph.sessionIds.codex
    });

    expect(detail).toMatchObject({
      externalSessionId: "codex-7f31",
      hookEvents: [
        expect.objectContaining({
          eventType: "tool.invoked",
          operation: "npm run db:migrate"
        }),
        expect.objectContaining({
          eventType: "approval.requested"
        })
      ],
      approvalRequests: [
        expect.objectContaining({
          actionSummary: "Apply migration and write project settings",
          status: "approved"
        })
      ],
      decisions: [
        expect.objectContaining({
          decision: "approved",
          reason: "Reviewed migration"
        })
      ]
    });
    expect(JSON.stringify(detail)).not.toContain(knownSecret);
    expect(JSON.stringify(detail)).not.toContain("local-dev-password");
  });

  it("enforces tenant isolation for list and detail access", async () => {
    const acme = await listSessions({
      databaseUrl,
      filters: {},
      organizationId: graph.organizationId
    });
    const globexDetail = await getSessionDetail({
      databaseUrl,
      organizationId: graph.organizationId,
      sessionId: graph.sessionIds.otherTenant
    });
    const globex = await listSessions({
      databaseUrl,
      filters: {},
      organizationId: graph.otherOrganizationId
    });
    const directRlsProbe = await querySessionByIdThroughTenantRole(
      databaseUrl,
      graph.organizationId,
      graph.sessionIds.otherTenant
    );

    expect(acme.sessions.map((session) => session.externalSessionId)).not.toContain("globex-codex");
    expect(globexDetail).toBeNull();
    expect(globex.sessions.map((session) => session.externalSessionId)).toEqual(["globex-codex"]);
    expect(directRlsProbe).toEqual([]);
  });

  it("fails closed for missing database configuration and invalid database roles", async () => {
    await expect(
      listSessions({
        databaseUrl: "",
        filters: {},
        organizationId: graph.organizationId
      })
    ).rejects.toThrow("DATABASE_URL is required.");
    await expect(
      listSessions({
        databaseRole: "bad-role;",
        databaseUrl,
        filters: {},
        organizationId: graph.organizationId
      })
    ).rejects.toThrow("Configured database role is invalid.");
  });
});
