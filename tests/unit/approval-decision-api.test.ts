import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { POST as approvePost } from "../../apps/web/app/api/approvals/[approvalId]/approve/route";
import { POST as denyPost } from "../../apps/web/app/api/approvals/[approvalId]/deny/route";
import { recordApprovalDecision } from "../../apps/web/app/api/approvals/decision-service";
import { migrate, resetDatabase } from "../../packages/db/src/migrate.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;

async function docker(args: string[]) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function startPostgres() {
  const name = `hookwire-api-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_api_test",
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

  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${match[1]}/hookwire_api_test`;
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

async function resetAndMigrate(databaseUrl: string) {
  await resetDatabase(databaseUrl);
  await migrate(databaseUrl);
}

type SeededGraph = {
  approvalRequestIds: {
    expired: string;
    pendingApprove: string;
    pendingDeny: string;
  };
  organizationId: string;
  otherOrganizationId: string;
  projectId: string;
  routeId: string;
  users: {
    admin: string;
    otherOrgAdmin: string;
    viewer: string;
  };
};

async function seedDecisionApiGraph(databaseUrl: string): Promise<SeededGraph> {
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
        values ($1, $2, $3, 'codex', $4, $4, 'issue-005-api-machine')
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
        values ($1, $2, $3, $4, 'codex', 'codex-issue-005', $5)
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
          ($1, $2, $3, $4, $5, 'pending', 'high', $6, 'codex-issue-005', 'Approve migration', '{}'::jsonb, now() + interval '15 minutes'),
          ($1, $2, $3, $4, $5, 'pending', 'medium', $6, 'codex-issue-005', 'Deny relay config patch', '{}'::jsonb, now() + interval '15 minutes'),
          ($1, $2, $3, $4, $5, 'pending', 'critical', $6, 'codex-issue-005', 'Expired deploy', '{}'::jsonb, now() - interval '1 minute')
        returning id, action_summary
      `,
      [organizationId, projectId, agentToolId, installationId, sessionId, routeId]
    );

    return {
      approvalRequestIds: {
        expired: requestRows.find((row) => row.action_summary === "Expired deploy").id,
        pendingApprove: requestRows.find((row) => row.action_summary === "Approve migration").id,
        pendingDeny: requestRows.find((row) => row.action_summary === "Deny relay config patch").id
      },
      organizationId,
      otherOrganizationId,
      projectId,
      routeId,
      users: {
        admin,
        otherOrgAdmin,
        viewer
      }
    };
  });
}

async function callRoute(
  routePost: typeof approvePost,
  approvalId: string,
  graph: SeededGraph,
  body: Record<string, unknown> = {},
  overrides: { organizationId?: string; userId?: string } = {}
) {
  const organizationId = overrides.organizationId ?? graph.organizationId;
  const userId = overrides.userId ?? graph.users.admin;
  const request = new Request(`http://localhost/api/approvals/${approvalId}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-hookwire-identity-signature": signIdentity(organizationId, userId),
      "x-hookwire-organization-id": organizationId,
      "x-hookwire-user-id": userId
    },
    method: "POST"
  });

  const response = await routePost(request, { params: Promise.resolve({ approvalId }) });
  const json = await response.json();

  return { json, response };
}

function signIdentity(organizationId: string, userId: string) {
  return createHmac("sha256", process.env.HOOKWIRE_INTERNAL_API_SECRET ?? "")
    .update(`${organizationId}:${userId}`)
    .digest("hex");
}

async function queryDecisionState(databaseUrl: string, approvalRequestId: string) {
  return withClient(databaseUrl, async (client) => {
    const { rows: requests } = await client.query(
      "select id, status from approval_requests where id = $1",
      [approvalRequestId]
    );
    const { rows: decisions } = await client.query(
      `
        select approval_request_id, user_id, source, decision, scope, reason
        from approval_decisions
        where approval_request_id = $1
        order by created_at
      `,
      [approvalRequestId]
    );
    const { rows: auditEvents } = await client.query(
      `
        select actor_user_id, event_type, entity_id, metadata_json
        from audit_events
        where entity_type = 'approval_request' and entity_id = $1
        order by created_at
      `,
      [approvalRequestId]
    );

    return { auditEvents, decisions, request: requests[0] };
  });
}

describe("approval decision API", () => {
  let containerId: string;
  let databaseUrl: string;
  let graph: SeededGraph;

  beforeAll(async () => {
    const postgres = await startPostgres();
    containerId = postgres.containerId;
    databaseUrl = postgres.databaseUrl;
    process.env.DATABASE_URL = databaseUrl;
    process.env.HOOKWIRE_DATABASE_ROLE = "hookwire_app";
    process.env.HOOKWIRE_INTERNAL_API_SECRET = "issue-005-test-secret";
  }, 30_000);

  beforeEach(async () => {
    await resetAndMigrate(databaseUrl);
    graph = await seedDecisionApiGraph(databaseUrl);
  });

  afterAll(async () => {
    if (containerId) {
      await docker(["stop", containerId]).catch(() => {});
    }
  });

  it("approves a pending request and persists actor, source, scope, status, and audit metadata", async () => {
    const { json, response } = await callRoute(approvePost, graph.approvalRequestIds.pendingApprove, graph, {
      scope: "once"
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      approvalRequestId: graph.approvalRequestIds.pendingApprove,
      decision: "approved",
      status: "approved"
    });

    const state = await queryDecisionState(databaseUrl, graph.approvalRequestIds.pendingApprove);
    expect(state.request).toMatchObject({ status: "approved" });
    expect(state.decisions).toEqual([
      expect.objectContaining({
        decision: "approved",
        reason: null,
        scope: "once",
        source: "web",
        user_id: graph.users.admin
      })
    ]);
    expect(state.auditEvents).toEqual([
      expect.objectContaining({
        actor_user_id: graph.users.admin,
        event_type: "approval.approved",
        metadata_json: expect.objectContaining({
          decision: "approved",
          reason: null,
          scope: "once",
          source: "web"
        })
      })
    ]);
  });

  it("denies a pending request with a required reason", async () => {
    const { json, response } = await callRoute(denyPost, graph.approvalRequestIds.pendingDeny, graph, {
      reason: "Touches protected relay routing",
      scope: "session"
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      decision: "denied",
      status: "denied"
    });

    const state = await queryDecisionState(databaseUrl, graph.approvalRequestIds.pendingDeny);
    expect(state.request).toMatchObject({ status: "denied" });
    expect(state.decisions).toEqual([
      expect.objectContaining({
        decision: "denied",
        reason: "Touches protected relay routing",
        scope: "session",
        source: "web",
        user_id: graph.users.admin
      })
    ]);
    expect(state.auditEvents[0]).toMatchObject({
      event_type: "approval.denied",
      metadata_json: expect.objectContaining({
        decision: "denied",
        reason: "Touches protected relay routing",
        scope: "session"
      })
    });
  });

  it("safely rejects repeat approve decisions without adding rows", async () => {
    const first = await callRoute(approvePost, graph.approvalRequestIds.pendingApprove, graph);
    const second = await callRoute(approvePost, graph.approvalRequestIds.pendingApprove, graph);

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(409);
    expect(second.json).toMatchObject({ code: "already_decided" });

    const state = await queryDecisionState(databaseUrl, graph.approvalRequestIds.pendingApprove);
    expect(state.decisions).toHaveLength(1);
    expect(state.auditEvents).toHaveLength(1);
  });

  it("safely rejects repeat deny decisions without adding rows", async () => {
    const first = await callRoute(denyPost, graph.approvalRequestIds.pendingDeny, graph, {
      reason: "Invalid route"
    });
    const second = await callRoute(denyPost, graph.approvalRequestIds.pendingDeny, graph);

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(409);
    expect(second.json).toMatchObject({ code: "already_decided" });

    const state = await queryDecisionState(databaseUrl, graph.approvalRequestIds.pendingDeny);
    expect(state.decisions).toHaveLength(1);
    expect(state.auditEvents).toHaveLength(1);
  });

  it("rejects expired requests and does not create a decision or audit event", async () => {
    const { json, response } = await callRoute(approvePost, graph.approvalRequestIds.expired, graph);

    expect(response.status).toBe(409);
    expect(json).toMatchObject({ code: "expired" });

    const state = await queryDecisionState(databaseUrl, graph.approvalRequestIds.expired);
    expect(state.request).toMatchObject({ status: "expired" });
    expect(state.decisions).toHaveLength(0);
    expect(state.auditEvents).toHaveLength(0);
  });

  it("rejects unauthorized users and wrong-organization users", async () => {
    const viewer = await callRoute(approvePost, graph.approvalRequestIds.pendingApprove, graph, {}, {
      userId: graph.users.viewer
    });
    const wrongOrganization = await callRoute(approvePost, graph.approvalRequestIds.pendingApprove, graph, {}, {
      userId: graph.users.otherOrgAdmin
    });

    expect(viewer.response.status).toBe(403);
    expect(viewer.json).toMatchObject({ code: "unauthorized" });
    expect(wrongOrganization.response.status).toBe(403);
    expect(wrongOrganization.json).toMatchObject({ code: "unauthorized" });

    const state = await queryDecisionState(databaseUrl, graph.approvalRequestIds.pendingApprove);
    expect(state.request).toMatchObject({ status: "pending" });
    expect(state.decisions).toHaveLength(0);
    expect(state.auditEvents).toHaveLength(0);
  });

  it("validates required denial reason and allowed scopes", async () => {
    const missingReason = await callRoute(denyPost, graph.approvalRequestIds.pendingDeny, graph);
    const invalidScope = await callRoute(approvePost, graph.approvalRequestIds.pendingApprove, graph, {
      scope: "forever"
    });

    expect(missingReason.response.status).toBe(400);
    expect(missingReason.json).toMatchObject({ code: "reason_required" });
    expect(invalidScope.response.status).toBe(400);
    expect(invalidScope.json).toMatchObject({ code: "invalid_scope" });
  });

  it("validates missing identity, missing requests, invalid JSON, and invalid decisions", async () => {
    const missingIdentityRequest = new Request(
      `http://localhost/api/approvals/${graph.approvalRequestIds.pendingApprove}/approve`,
      { method: "POST" }
    );
    const missingIdentity = await approvePost(missingIdentityRequest, {
      params: Promise.resolve({ approvalId: graph.approvalRequestIds.pendingApprove })
    });
    const missingRequest = await callRoute(approvePost, randomUUID(), graph);
    const invalidJsonRequest = new Request(
      `http://localhost/api/approvals/${graph.approvalRequestIds.pendingDeny}/deny`,
      {
        body: "{",
        headers: {
          "content-type": "application/json",
          "x-hookwire-identity-signature": signIdentity(graph.organizationId, graph.users.admin),
          "x-hookwire-organization-id": graph.organizationId,
          "x-hookwire-user-id": graph.users.admin
        },
        method: "POST"
      }
    );
    const invalidJson = await denyPost(invalidJsonRequest, {
      params: Promise.resolve({ approvalId: graph.approvalRequestIds.pendingDeny })
    });

    await expect(
      recordApprovalDecision({
        approvalRequestId: graph.approvalRequestIds.pendingApprove,
        databaseUrl,
        decision: "maybe" as "approved",
        organizationId: graph.organizationId,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "invalid_decision", status: 400 });

    expect(missingIdentity.status).toBe(400);
    await expect(missingIdentity.json()).resolves.toMatchObject({ code: "missing_identity" });
    expect(missingRequest.response.status).toBe(404);
    expect(missingRequest.json).toMatchObject({ code: "not_found" });
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toMatchObject({ code: "reason_required" });
  });

  it("rejects unsigned and incorrectly signed identity headers before decision processing", async () => {
    const unsignedRequest = new Request(
      `http://localhost/api/approvals/${graph.approvalRequestIds.pendingApprove}/approve`,
      {
        headers: {
          "x-hookwire-organization-id": graph.organizationId,
          "x-hookwire-user-id": graph.users.admin
        },
        method: "POST"
      }
    );
    const invalidSignedRequest = new Request(
      `http://localhost/api/approvals/${graph.approvalRequestIds.pendingApprove}/approve`,
      {
        headers: {
          "x-hookwire-identity-signature": signIdentity(graph.organizationId, graph.users.viewer),
          "x-hookwire-organization-id": graph.organizationId,
          "x-hookwire-user-id": graph.users.admin
        },
        method: "POST"
      }
    );

    const unsigned = await approvePost(unsignedRequest, {
      params: Promise.resolve({ approvalId: graph.approvalRequestIds.pendingApprove })
    });
    const invalid = await approvePost(invalidSignedRequest, {
      params: Promise.resolve({ approvalId: graph.approvalRequestIds.pendingApprove })
    });

    expect(unsigned.status).toBe(401);
    await expect(unsigned.json()).resolves.toMatchObject({ code: "missing_identity_signature" });
    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toMatchObject({ code: "invalid_identity_signature" });

    const state = await queryDecisionState(databaseUrl, graph.approvalRequestIds.pendingApprove);
    expect(state.request).toMatchObject({ status: "pending" });
    expect(state.decisions).toHaveLength(0);
    expect(state.auditEvents).toHaveLength(0);
  });

  it("fails closed when no database URL is configured", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      await expect(
        recordApprovalDecision({
          approvalRequestId: graph.approvalRequestIds.pendingApprove,
          decision: "approved",
          organizationId: graph.organizationId,
          userId: graph.users.admin
        })
      ).rejects.toMatchObject({ code: "database_not_configured", status: 500 });
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  it("rolls back request status and decision rows when audit creation fails", async () => {
    await expect(
      recordApprovalDecision({
        approvalRequestId: graph.approvalRequestIds.pendingApprove,
        databaseUrl,
        decision: "approved",
        organizationId: graph.organizationId,
        scope: "once",
        testHooks: { failBeforeAuditInsert: true },
        userId: graph.users.admin
      })
    ).rejects.toThrow("Injected failure before audit insert");

    const state = await queryDecisionState(databaseUrl, graph.approvalRequestIds.pendingApprove);
    expect(state.request).toMatchObject({ status: "pending" });
    expect(state.decisions).toHaveLength(0);
    expect(state.auditEvents).toHaveLength(0);
  });
});
