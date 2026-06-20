import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import {
  auditEventTypes,
  createAuditTimeline,
  filterAuditEvents,
  getSelectedAuditEvent,
  labelForEntityType,
  redactAuditMetadata
} from "../../apps/web/app/audit/domain";
import { appendAuditEvent, listAuditEvents } from "../../apps/web/app/audit/audit-service";
import { migrate, resetDatabase } from "../../packages/db/src/migrate.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;

const requiredEventTypes = [
  "approval.requested",
  "approval.approved",
  "policy.changed",
  "route.changed",
  "key.registered",
  "key.revoked",
  "session.claimed",
  "local_override.used"
] as const;

async function docker(args: string[]) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function startPostgres() {
  const name = `hookwire-audit-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_audit_test",
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

  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${match[1]}/hookwire_audit_test`;
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

type SeededAuditGraph = {
  approvalRequestId: string;
  organizationId: string;
  otherOrganizationId: string;
  policyId: string;
  projectId: string;
  routeId: string;
  sessionId: string;
  userDeviceKeyId: string;
  users: {
    admin: string;
    reviewer: string;
  };
};

async function seedAuditGraph(databaseUrl: string): Promise<SeededAuditGraph> {
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
      values ('admin@acme.dev', 'Admin'), ('reviewer@acme.dev', 'Reviewer')
      returning id, email
    `);
    const admin = userRows.find((row) => row.email === "admin@acme.dev").id;
    const reviewer = userRows.find((row) => row.email === "reviewer@acme.dev").id;

    await client.query(
      `
        insert into memberships (organization_id, user_id, role)
        values ($1, $2, 'admin'), ($1, $3, 'member')
      `,
      [organizationId, admin, reviewer]
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

    const { rows: keyRows } = await client.query(
      `
        insert into user_device_keys (organization_id, user_id, public_key, key_fingerprint, display_name)
        values ($1, $2, 'public-key-material', 'SHA256:audit-key', 'Maya laptop')
        returning id
      `,
      [organizationId, admin]
    );
    const userDeviceKeyId = keyRows[0].id;

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
          organization_id, project_id, agent_tool_id, agent_type, registered_by_user_id,
          owner_user_id, machine_fingerprint, relay_version
        )
        values ($1, $2, $3, 'codex', $4, $4, 'audit-machine', '0.0.0')
        returning id
      `,
      [organizationId, projectId, agentToolId, admin]
    );
    const installationId = installationRows[0].id;

    const { rows: sessionRows } = await client.query(
      `
        insert into agent_sessions (
          organization_id, project_id, agent_tool_id, agent_installation_id,
          agent_type, external_session_id, started_by_user_id, claimed_by_user_id, branch, status
        )
        values ($1, $2, $3, $4, 'codex', 'codex-audit-1', $5, $6, 'codex/issue-009-audit-timeline', 'active')
        returning id
      `,
      [organizationId, projectId, agentToolId, installationId, admin, reviewer]
    );
    const sessionId = sessionRows[0].id;

    const { rows: routeRows } = await client.query(
      "insert into routes (organization_id, name) values ($1, 'Web inbox') returning id",
      [organizationId]
    );
    const routeId = routeRows[0].id;

    const { rows: approvalRows } = await client.query(
      `
        insert into approval_requests (
          organization_id, project_id, agent_tool_id, agent_installation_id,
          agent_session_id, route_id, requested_by_agent, action_summary, risk_level
        )
        values ($1, $2, $3, $4, $5, $6, 'codex', 'Write route config', 'high')
        returning id
      `,
      [organizationId, projectId, agentToolId, installationId, sessionId, routeId]
    );
    const approvalRequestId = approvalRows[0].id;

    const { rows: policyRows } = await client.query(
      `
        insert into policies (organization_id, project_id, name, status, default_decision, created_by_user_id)
        values ($1, $2, 'Deploy guard', 'active', 'ask', $3)
        returning id
      `,
      [organizationId, projectId, admin]
    );
    const policyId = policyRows[0].id;

    return {
      approvalRequestId,
      organizationId,
      otherOrganizationId,
      policyId,
      projectId,
      routeId,
      sessionId,
      userDeviceKeyId,
      users: { admin, reviewer }
    };
  });
}

describe("audit timeline domain", () => {
  it("models required audit events and filters project, entity, and user views", () => {
    const timeline = createAuditTimeline();

    expect(auditEventTypes).toEqual(requiredEventTypes);
    expect(filterAuditEvents(timeline.events, { projectId: "project-web" }).length).toBeGreaterThan(0);
    expect(filterAuditEvents(timeline.events, { entityType: "approval_request", entityId: "approval-apr-1042" })).toHaveLength(1);
    expect(filterAuditEvents(timeline.events, { entityType: "policy", entityId: "policy-deploy-guard" })).toHaveLength(1);
    expect(filterAuditEvents(timeline.events, { actorUserId: "user-maya" }).map((event) => event.eventType)).toContain(
      "session.claimed"
    );
    expect(filterAuditEvents(timeline.events, {})).toHaveLength(timeline.events.length);
    expect(filterAuditEvents(timeline.events, { actorUserId: "all", entityType: "all", projectId: "all" })).toHaveLength(
      timeline.events.length
    );
    expect(filterAuditEvents(timeline.events, { entityType: "approval_request", entityId: "missing" })).toHaveLength(0);
    expect(getSelectedAuditEvent(timeline.events, "audit-local-override")?.eventType).toBe("local_override.used");
    expect(getSelectedAuditEvent(timeline.events, "missing")?.id).toBe(timeline.events[0].id);
    expect(getSelectedAuditEvent([], "missing")).toBeNull();
    expect(labelForEntityType("user_device_key")).toBe("user device key");
  });

  it("redacts secret metadata recursively before display or persistence", () => {
    const redacted = redactAuditMetadata({
      authorization: "Bearer raw-super-token",
      command: "curl https://api.example.test?password=hunter2&api_key=live-api-key",
      nested: {
        githubToken: "ghp_rawgithubtoken",
        safe: "keep this value",
        secret: "sk-live-super-secret"
      }
    });
    const text = JSON.stringify(redacted);

    expect(text).toContain("keep this value");
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("raw-super-token");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("live-api-key");
    expect(text).not.toContain("ghp_rawgithubtoken");
    expect(text).not.toContain("sk-live-super-secret");
    expect(redactAuditMetadata(["safe", "Bearer hidden"])).toEqual({ value: ["safe", "Bearer [REDACTED]"] });
    expect(redactAuditMetadata(42)).toEqual({ value: 42 });
    expect(redactAuditMetadata(true)).toEqual({ value: true });
    expect(redactAuditMetadata(undefined)).toEqual({ value: null });
  });
});

describe("audit timeline database service", () => {
  let containerId: string;
  let databaseUrl: string;
  let graph: SeededAuditGraph;

  beforeAll(async () => {
    const postgres = await startPostgres();
    containerId = postgres.containerId;
    databaseUrl = postgres.databaseUrl;
    process.env.HOOKWIRE_DATABASE_ROLE = "hookwire_app";
  }, 30_000);

  beforeEach(async () => {
    await resetDatabase(databaseUrl);
    await migrate(databaseUrl);
    graph = await seedAuditGraph(databaseUrl);
  });

  afterAll(async () => {
    if (containerId) {
      await docker(["stop", containerId]).catch(() => {});
    }
  });

  it("persists required audit events, actor attribution, and redacted metadata", async () => {
    for (const eventType of requiredEventTypes) {
      await appendAuditEvent({
        actorType: eventType.startsWith("approval.") ? "relay" : "user",
        actorUserId: eventType.startsWith("approval.") ? null : graph.users.admin,
        databaseUrl,
        entityId: entityIdForEvent(eventType, graph),
        entityType: entityTypeForEvent(eventType),
        eventType,
        metadata: {
          authorization: "Bearer raw-super-token",
          command: "deploy --token sk-live-super-secret --safe",
          nested: { githubToken: "ghp_rawgithubtoken", note: "public audit note" }
        },
        organizationId: graph.organizationId,
        projectId: graph.projectId
      });
    }

    const timeline = await listAuditEvents({ databaseUrl, organizationId: graph.organizationId });
    const eventTypes = timeline.events.map((event) => event.eventType);
    const serialized = JSON.stringify(timeline);

    expect(new Set(eventTypes)).toEqual(new Set(requiredEventTypes));
    expect(timeline.events.find((event) => event.eventType === "policy.changed")).toMatchObject({
      actor: { type: "user", userId: graph.users.admin, userName: "Admin" },
      entityType: "policy",
      projectId: graph.projectId,
      projectName: "hookwire/web"
    });
    expect(serialized).toContain("public audit note");
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain("raw-super-token");
    expect(serialized).not.toContain("sk-live-super-secret");
    expect(serialized).not.toContain("ghp_rawgithubtoken");
  });

  it("filters audit events by project, session, approval request, policy, and user", async () => {
    await seedRequiredAuditEvents(databaseUrl, graph);

    await expect(listAuditEvents({ databaseUrl, organizationId: graph.organizationId, projectId: graph.projectId })).resolves
      .toMatchObject({ events: expect.arrayContaining([expect.objectContaining({ eventType: "approval.requested" })]) });
    await expect(
      listAuditEvents({
        databaseUrl,
        entityId: graph.sessionId,
        entityType: "agent_session",
        organizationId: graph.organizationId
      })
    ).resolves.toMatchObject({ events: [expect.objectContaining({ eventType: "session.claimed" })] });
    await expect(
      listAuditEvents({
        databaseUrl,
        entityId: graph.approvalRequestId,
        entityType: "approval_request",
        organizationId: graph.organizationId
      })
    ).resolves.toMatchObject({ events: [expect.objectContaining({ eventType: "approval.requested" })] });
    await expect(
      listAuditEvents({
        databaseUrl,
        entityId: graph.policyId,
        entityType: "policy",
        organizationId: graph.organizationId
      })
    ).resolves.toMatchObject({ events: [expect.objectContaining({ eventType: "policy.changed" })] });
    await expect(
      listAuditEvents({ actorUserId: graph.users.reviewer, databaseUrl, organizationId: graph.organizationId })
    ).resolves.toMatchObject({ events: [expect.objectContaining({ eventType: "session.claimed" })] });
  });

  it("keeps audit rows tenant-scoped and append-only for the application role", async () => {
    const event = await appendAuditEvent({
      actorType: "user",
      actorUserId: graph.users.admin,
      databaseUrl,
      entityId: graph.policyId,
      entityType: "policy",
      eventType: "policy.changed",
      metadata: { change: "created" },
      organizationId: graph.organizationId,
      projectId: graph.projectId
    });

    await withClient(databaseUrl, async (client) => {
      await client.query(
        `
          insert into audit_events (organization_id, actor_type, event_type, entity_type, metadata_json)
          values ($1, 'system', 'policy.changed', 'policy', '{"tenant":"globex"}'::jsonb)
        `,
        [graph.otherOrganizationId]
      );
    });

    const timeline = await listAuditEvents({ databaseUrl, organizationId: graph.organizationId });
    expect(timeline.events.map((row) => row.id)).toEqual([event.id]);
    await expectHookwireAppMutationRejected(databaseUrl, graph.organizationId, "update audit_events set metadata_json = '{}'::jsonb where id = $1", [
      event.id
    ]);
    await expectHookwireAppMutationRejected(databaseUrl, graph.organizationId, "delete from audit_events where id = $1", [
      event.id
    ]);
  });

  it("rejects invalid audit input and unsafe database configuration", async () => {
    await expect(
      appendAuditEvent({
        actorType: "user",
        actorUserId: graph.users.admin,
        databaseUrl,
        entityType: "policy",
        eventType: "invalid.event" as never,
        organizationId: graph.organizationId
      })
    ).rejects.toMatchObject({ code: "invalid_event_type", status: 400 });
    await expect(
      appendAuditEvent({
        actorType: "bot" as never,
        databaseUrl,
        entityType: "policy",
        eventType: "policy.changed",
        organizationId: graph.organizationId
      })
    ).rejects.toMatchObject({ code: "invalid_actor_type", status: 400 });
    await expect(
      appendAuditEvent({
        actorType: "user",
        databaseUrl,
        entityType: "policy",
        eventType: "policy.changed",
        organizationId: graph.organizationId
      })
    ).rejects.toMatchObject({ code: "actor_user_required", status: 400 });
    await expect(
      appendAuditEvent({
        actorType: "system",
        databaseUrl,
        entityType: "unknown" as never,
        eventType: "policy.changed",
        organizationId: graph.organizationId
      })
    ).rejects.toMatchObject({ code: "invalid_entity_type", status: 400 });
    await expect(
      listAuditEvents({
        databaseUrl,
        entityType: "unknown" as never,
        organizationId: graph.organizationId
      })
    ).rejects.toMatchObject({ code: "invalid_entity_type", status: 400 });
    await expect(listAuditEvents({ databaseUrl, limit: 0, organizationId: graph.organizationId })).rejects.toMatchObject({
      code: "invalid_limit",
      status: 400
    });
    await expect(
      listAuditEvents({ databaseRole: "bad-role;", databaseUrl, organizationId: graph.organizationId })
    ).rejects.toMatchObject({ code: "invalid_database_role", status: 500 });

    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(listAuditEvents({ organizationId: graph.organizationId })).rejects.toMatchObject({
        code: "database_not_configured",
        status: 500
      });
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it("labels system, relay, and integration actors when no user is attached", async () => {
    await appendAuditEvent({
      actorType: "integration",
      databaseUrl,
      entityId: graph.routeId,
      entityType: "route",
      eventType: "route.changed",
      organizationId: graph.organizationId,
      projectId: graph.projectId
    });
    await appendAuditEvent({
      actorType: "relay",
      databaseUrl,
      entityId: graph.approvalRequestId,
      entityType: "approval_request",
      eventType: "approval.requested",
      organizationId: graph.organizationId,
      projectId: graph.projectId
    });
    await appendAuditEvent({
      actorType: "system",
      databaseUrl,
      entityId: graph.policyId,
      entityType: "policy",
      eventType: "policy.changed",
      organizationId: graph.organizationId,
      projectId: graph.projectId
    });

    const timeline = await listAuditEvents({ databaseUrl, organizationId: graph.organizationId });
    expect(timeline.events.map((event) => event.actor.userName)).toEqual(expect.arrayContaining(["Integration", "Relay", "System"]));
  });
});

async function seedRequiredAuditEvents(databaseUrl: string, graph: SeededAuditGraph) {
  for (const eventType of requiredEventTypes) {
    await appendAuditEvent({
      actorType: eventType === "session.claimed" ? "user" : "system",
      actorUserId: eventType === "session.claimed" ? graph.users.reviewer : null,
      databaseUrl,
      entityId: entityIdForEvent(eventType, graph),
      entityType: entityTypeForEvent(eventType),
      eventType,
      metadata: { eventType },
      organizationId: graph.organizationId,
      projectId: graph.projectId
    });
  }
}

function entityTypeForEvent(eventType: (typeof requiredEventTypes)[number]) {
  switch (eventType) {
    case "approval.requested":
      return "approval_request";
    case "approval.approved":
      return "approval_decision";
    case "policy.changed":
      return "policy";
    case "route.changed":
      return "route";
    case "key.registered":
    case "key.revoked":
      return "user_device_key";
    case "session.claimed":
      return "agent_session";
    case "local_override.used":
      return "local_override";
  }
}

function entityIdForEvent(eventType: (typeof requiredEventTypes)[number], graph: SeededAuditGraph) {
  switch (eventType) {
    case "approval.requested":
      return graph.approvalRequestId;
    case "approval.approved":
      return randomUUID();
    case "policy.changed":
      return graph.policyId;
    case "route.changed":
      return graph.routeId;
    case "key.registered":
    case "key.revoked":
      return graph.userDeviceKeyId;
    case "session.claimed":
      return graph.sessionId;
    case "local_override.used":
      return null;
  }
}

async function expectHookwireAppMutationRejected(
  databaseUrl: string,
  organizationId: string,
  sql: string,
  params: unknown[]
) {
  await withClient(databaseUrl, async (client) => {
    await client.query("begin");
    await client.query('set local role "hookwire_app"');
    await client.query("select set_config('app.current_organization_id', $1, true)", [organizationId]);
    await expect(client.query(sql, params)).rejects.toMatchObject({ code: "42501" });
    await client.query("rollback");
  });
}
