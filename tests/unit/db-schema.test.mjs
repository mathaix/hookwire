import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate, resetDatabase } from "../../packages/db/src/migrate.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;

const expectedTables = [
  "agent_installations",
  "agent_session_identities",
  "agent_sessions",
  "agent_tools",
  "approval_decisions",
  "approval_deliveries",
  "approval_group_members",
  "approval_groups",
  "approval_requests",
  "audit_events",
  "hook_events",
  "installation_credentials",
  "integration_identities",
  "integrations",
  "memberships",
  "on_call_assignments",
  "on_call_schedules",
  "onboarding_sessions",
  "organizations",
  "policies",
  "policy_rules",
  "project_memberships",
  "projects",
  "relay_request_nonces",
  "route_targets",
  "routes",
  "schema_migrations",
  "user_device_keys",
  "users"
];

const tenantTables = [
  "organizations",
  "users",
  "projects",
  "agent_sessions",
  "approval_requests",
  "approval_deliveries",
  "approval_decisions",
  "routes",
  "route_targets",
  "integrations",
  "audit_events"
];

const requiredConstraints = [
  "memberships_organization_user_unique",
  "project_memberships_organization_project_user_unique",
  "projects_organization_slug_unique",
  "agent_tools_agent_type_check",
  "agent_installations_agent_type_check",
  "agent_installations_revoked_by_same_org_fk",
  "agent_installations_revoked_state_check",
  "installation_credentials_fingerprint_unique",
  "relay_request_nonces_credential_nonce_unique",
  "agent_sessions_external_session_unique",
  "routes_fallback_same_org_fk",
  "route_targets_target_type_check",
  "integrations_provider_check",
  "integration_identities_external_user_unique",
  "approval_decisions_approval_user_unique"
];

const requiredForeignKeys = [
  "memberships_organization_fk",
  "memberships_user_fk",
  "projects_organization_fk",
  "agent_tools_project_same_org_fk",
  "agent_installations_tool_same_org_fk",
  "installation_credentials_installation_same_org_fk",
  "agent_sessions_installation_same_org_fk",
  "hook_events_session_same_org_fk",
  "policy_rules_policy_same_org_fk",
  "route_targets_route_same_org_fk",
  "approval_requests_session_same_org_fk",
  "approval_deliveries_request_same_org_fk",
  "approval_decisions_request_same_org_fk",
  "audit_events_project_same_org_fk"
];

const requiredNonNullColumns = [
  ["organizations", "slug"],
  ["users", "email"],
  ["memberships", "role"],
  ["projects", "organization_id"],
  ["agent_tools", "agent_type"],
  ["agent_installations", "status"],
  ["installation_credentials", "public_key"],
  ["agent_sessions", "status"],
  ["hook_events", "payload_redacted"],
  ["policies", "default_decision"],
  ["routes", "approvals_required"],
  ["route_targets", "target_type"],
  ["approval_requests", "status"],
  ["approval_decisions", "decision"],
  ["audit_events", "event_type"]
];

async function docker(args) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function startPostgres() {
  const name = `hookwire-db-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_test",
    "-p",
    "127.0.0.1::5432",
    "postgres:16"
  ]);

  const containerId = stdout.trim();
  const port = await mappedPort(containerId);
  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${port}/hookwire_test`;
  await waitForPostgres(databaseUrl);

  return { containerId, databaseUrl };
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

async function withAdmin(databaseUrl, callback) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function queryRows(databaseUrl, sql, params = []) {
  return withAdmin(databaseUrl, async (client) => {
    const result = await client.query(sql, params);
    return result.rows;
  });
}

async function resetAndMigrate(databaseUrl) {
  await resetDatabase(databaseUrl);
  await migrate(databaseUrl);
}

async function expectQueryRejected(client, sql, params, pattern) {
  await client.query("savepoint expected_error");
  await expect(client.query(sql, params)).rejects.toThrow(pattern);
  await client.query("rollback to savepoint expected_error");
  await client.query("release savepoint expected_error");
}

async function seedTenantIsolationData(databaseUrl) {
  return withAdmin(databaseUrl, async (client) => {
    const { rows: orgs } = await client.query(`
      insert into organizations (name, slug)
      values ('Acme', 'acme'), ('Globex', 'globex')
      returning id, slug
    `);
    const orgA = orgs.find((org) => org.slug === "acme").id;
    const orgB = orgs.find((org) => org.slug === "globex").id;

    const { rows: users } = await client.query(`
      insert into users (email, name)
      values ('alice@example.com', 'Alice'), ('bob@example.com', 'Bob')
      returning id, email
    `);
    const alice = users.find((user) => user.email === "alice@example.com").id;
    const bob = users.find((user) => user.email === "bob@example.com").id;

    await client.query(
      `
        insert into memberships (organization_id, user_id, role)
        values ($1, $2, 'admin'), ($3, $4, 'admin')
      `,
      [orgA, alice, orgB, bob]
    );

    const { rows: projects } = await client.query(
      `
        insert into projects (organization_id, name, slug)
        values ($1, 'Acme Project', 'acme-project'), ($2, 'Globex Project', 'globex-project')
        returning id, organization_id, slug
      `,
      [orgA, orgB]
    );
    const projectA = projects.find((project) => project.organization_id === orgA).id;
    const projectB = projects.find((project) => project.organization_id === orgB).id;

    const { rows: tools } = await client.query(
      `
        insert into agent_tools (organization_id, project_id, agent_type, display_name, created_by_user_id)
        values ($1, $2, 'codex', 'Codex', $3), ($4, $5, 'claude', 'Claude Code', $6)
        returning id, organization_id
      `,
      [orgA, projectA, alice, orgB, projectB, bob]
    );
    const toolA = tools.find((tool) => tool.organization_id === orgA).id;
    const toolB = tools.find((tool) => tool.organization_id === orgB).id;

    const { rows: installations } = await client.query(
      `
        insert into agent_installations (
          organization_id, project_id, agent_tool_id, agent_type, registered_by_user_id, owner_user_id, machine_fingerprint
        )
        values ($1, $2, $3, 'codex', $4, $4, 'machine-a'), ($5, $6, $7, 'claude', $8, $8, 'machine-b')
        returning id, organization_id
      `,
      [orgA, projectA, toolA, alice, orgB, projectB, toolB, bob]
    );
    const installationA = installations.find((installation) => installation.organization_id === orgA).id;
    const installationB = installations.find((installation) => installation.organization_id === orgB).id;

    const { rows: sessions } = await client.query(
      `
        insert into agent_sessions (
          organization_id, project_id, agent_tool_id, agent_installation_id, agent_type, external_session_id, started_by_user_id
        )
        values ($1, $2, $3, $4, 'codex', 'session-a', $5), ($6, $7, $8, $9, 'claude', 'session-b', $10)
        returning id, organization_id
      `,
      [orgA, projectA, toolA, installationA, alice, orgB, projectB, toolB, installationB, bob]
    );
    const sessionA = sessions.find((session) => session.organization_id === orgA).id;
    const sessionB = sessions.find((session) => session.organization_id === orgB).id;

    const { rows: routes } = await client.query(
      `
        insert into routes (organization_id, name, approvals_required, timeout_seconds)
        values ($1, 'Acme Web Inbox', 1, 900), ($2, 'Globex Web Inbox', 1, 900)
        returning id, organization_id
      `,
      [orgA, orgB]
    );
    const routeA = routes.find((route) => route.organization_id === orgA).id;
    const routeB = routes.find((route) => route.organization_id === orgB).id;

    const { rows: routeTargets } = await client.query(
      `
        insert into route_targets (organization_id, route_id, target_type, priority)
        values ($1, $2, 'web_inbox', 100), ($3, $4, 'web_inbox', 100)
        returning id, organization_id
      `,
      [orgA, routeA, orgB, routeB]
    );
    const routeTargetA = routeTargets.find((routeTarget) => routeTarget.organization_id === orgA).id;
    const routeTargetB = routeTargets.find((routeTarget) => routeTarget.organization_id === orgB).id;

    const { rows: integrations } = await client.query(
      `
        insert into integrations (organization_id, provider, name, status, created_by_user_id)
        values ($1, 'slack', 'Acme Slack', 'active', $2), ($3, 'jira', 'Globex Jira', 'active', $4)
        returning id, organization_id
      `,
      [orgA, alice, orgB, bob]
    );
    const integrationA = integrations.find((integration) => integration.organization_id === orgA).id;
    const integrationB = integrations.find((integration) => integration.organization_id === orgB).id;

    const { rows: requests } = await client.query(
      `
        insert into approval_requests (
          organization_id, project_id, agent_tool_id, agent_installation_id, agent_session_id, route_id,
          requested_by_agent, action_summary
        )
        values ($1, $2, $3, $4, $5, $6, 'codex', 'Run tests'), ($7, $8, $9, $10, $11, $12, 'claude', 'Deploy')
        returning id, organization_id
      `,
      [orgA, projectA, toolA, installationA, sessionA, routeA, orgB, projectB, toolB, installationB, sessionB, routeB]
    );
    const requestA = requests.find((request) => request.organization_id === orgA).id;
    const requestB = requests.find((request) => request.organization_id === orgB).id;

    const { rows: deliveries } = await client.query(
      `
        insert into approval_deliveries (
          organization_id, approval_request_id, route_target_id, provider, destination
        )
        values ($1, $2, $3, 'web_inbox', 'inbox'), ($4, $5, $6, 'web_inbox', 'inbox')
        returning id, organization_id
      `,
      [orgA, requestA, routeTargetA, orgB, requestB, routeTargetB]
    );
    const deliveryA = deliveries.find((delivery) => delivery.organization_id === orgA).id;
    const deliveryB = deliveries.find((delivery) => delivery.organization_id === orgB).id;

    const { rows: decisions } = await client.query(
      `
        insert into approval_decisions (organization_id, approval_request_id, user_id, source, decision, reason)
        values ($1, $2, $3, 'web', 'approved', 'ok'), ($4, $5, $6, 'web', 'denied', 'no')
        returning id, organization_id
      `,
      [orgA, requestA, alice, orgB, requestB, bob]
    );
    const decisionA = decisions.find((decision) => decision.organization_id === orgA).id;
    const decisionB = decisions.find((decision) => decision.organization_id === orgB).id;

    const { rows: auditEvents } = await client.query(
      `
        insert into audit_events (organization_id, project_id, actor_type, actor_user_id, event_type, entity_type, entity_id)
        values
          ($1, $2, 'user', $3, 'approval.requested', 'approval_request', $4),
          ($5, $6, 'user', $7, 'approval.requested', 'approval_request', $8)
        returning id, organization_id
      `,
      [orgA, projectA, alice, requestA, orgB, projectB, bob, requestB]
    );
    const auditEventA = auditEvents.find((auditEvent) => auditEvent.organization_id === orgA).id;
    const auditEventB = auditEvents.find((auditEvent) => auditEvent.organization_id === orgB).id;

    return {
      orgA,
      orgB,
      alice,
      bob,
      projectA,
      projectB,
      sessionA,
      sessionB,
      requestA,
      requestB,
      deliveryA,
      deliveryB,
      decisionA,
      decisionB,
      routeA,
      routeB,
      routeTargetA,
      routeTargetB,
      integrationA,
      integrationB,
      auditEventA,
      auditEventB
    };
  });
}

describe("multiuser database schema", () => {
  let container;

  afterAll(async () => {
    if (container?.containerId) {
      await docker(["rm", "-f", container.containerId]).catch(() => {});
    }
  });

  it("applies clean migrations and can reset then re-apply them", async () => {
    container = await startPostgres();

    await resetDatabase(container.databaseUrl);
    const firstRun = await migrate(container.databaseUrl);
    expect(firstRun.applied).toEqual(["0001_initial_schema.sql"]);

    const secondRun = await migrate(container.databaseUrl);
    expect(secondRun.applied).toEqual([]);

    await resetDatabase(container.databaseUrl);
    const resetRun = await migrate(container.databaseUrl);
    expect(resetRun.applied).toEqual(["0001_initial_schema.sql"]);

    const tables = await queryRows(
      container.databaseUrl,
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name
      `
    );

    expect(tables.map((table) => table.table_name)).toEqual(expectedTables);
  }, 60_000);

  it("declares tenant-scoped relations, required fields, and supported provider checks", async () => {
    await resetAndMigrate(container.databaseUrl);

    const constraints = await queryRows(
      container.databaseUrl,
      `
        select conname, contype, pg_get_constraintdef(oid) as definition
        from pg_constraint
        where connamespace = 'public'::regnamespace
        order by conname
      `
    );
    const constraintNames = constraints.map((constraint) => constraint.conname);

    expect(constraintNames).toEqual(expect.arrayContaining(requiredConstraints));
    expect(constraintNames).toEqual(expect.arrayContaining(requiredForeignKeys));

    const agentToolCheck = constraints.find((constraint) => constraint.conname === "agent_tools_agent_type_check").definition;
    expect(agentToolCheck).toContain("'claude'");
    expect(agentToolCheck).toContain("'codex'");
    expect(agentToolCheck).toContain("'openclaw'");

    const routeTargetCheck = constraints.find((constraint) => constraint.conname === "route_targets_target_type_check").definition;
    for (const target of ["web_inbox", "slack", "sms", "jira", "linear", "github", "email", "webhook", "local_terminal"]) {
      expect(routeTargetCheck).toContain(`'${target}'`);
    }

    const integrationProviderCheck = constraints.find((constraint) => constraint.conname === "integrations_provider_check").definition;
    for (const provider of ["slack", "twilio", "jira", "linear", "github", "email", "webhook"]) {
      expect(integrationProviderCheck).toContain(`'${provider}'`);
    }

    const nonNullColumns = await queryRows(
      container.databaseUrl,
      `
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public' and is_nullable = 'NO'
        order by table_name, column_name
      `
    );
    const nonNullSet = new Set(nonNullColumns.map((column) => `${column.table_name}.${column.column_name}`));

    for (const [table, column] of requiredNonNullColumns) {
      expect(nonNullSet.has(`${table}.${column}`)).toBe(true);
    }
  }, 60_000);

  it("enforces tenant isolation for reads and mutations through the application role", async () => {
    await resetAndMigrate(container.databaseUrl);
    const seeded = await seedTenantIsolationData(container.databaseUrl);

    await withAdmin(container.databaseUrl, async (client) => {
      await client.query("begin");
      await client.query("set role hookwire_app");
      await client.query("select set_config('app.current_organization_id', $1, true)", [seeded.orgA]);

      for (const table of tenantTables) {
        if (table === "organizations") {
          const { rows } = await client.query("select id from organizations order by id");
          expect(rows).toEqual([{ id: seeded.orgA }]);
        } else if (table === "users") {
          const { rows } = await client.query("select id from users order by id");
          expect(rows).toEqual([{ id: seeded.alice }]);
        } else {
          const { rows } = await client.query(`select distinct organization_id from ${table} order by organization_id`);
          expect(rows).toEqual([{ organization_id: seeded.orgA }]);
        }
      }

      const updateCases = [
        ["projects", "updated_at = now()", seeded.projectB],
        ["agent_sessions", "updated_at = now()", seeded.sessionB],
        ["approval_requests", "updated_at = now()", seeded.requestB],
        ["approval_deliveries", "updated_at = now()", seeded.deliveryB],
        ["approval_decisions", "reason = 'leak'", seeded.decisionB],
        ["routes", "updated_at = now()", seeded.routeB],
        ["route_targets", "updated_at = now()", seeded.routeTargetB],
        ["integrations", "updated_at = now()", seeded.integrationB],
        ["audit_events", "metadata_json = '{\"leak\":true}'::jsonb", seeded.auditEventB]
      ];

      for (const [table, setClause, id] of updateCases) {
        const { rowCount } = await client.query(`update ${table} set ${setClause} where id = $1`, [id]);
        expect(rowCount).toBe(0);
      }

      const deleteCases = [
        ["approval_deliveries", seeded.deliveryB],
        ["approval_decisions", seeded.decisionB],
        ["audit_events", seeded.auditEventB]
      ];

      for (const [table, id] of deleteCases) {
        const { rowCount } = await client.query(`delete from ${table} where id = $1`, [id]);
        expect(rowCount).toBe(0);
      }

      await expectQueryRejected(
        client,
        "update organizations set name = 'Leak' where id = $1",
        [seeded.orgB],
        /permission denied|row-level security/i
      );
      await expectQueryRejected(
        client,
        "update users set name = 'Leak' where id = $1",
        [seeded.bob],
        /permission denied|row-level security/i
      );
      await expectQueryRejected(
        client,
        "insert into projects (organization_id, name, slug) values ($1, 'Cross Tenant', 'cross-tenant')",
        [seeded.orgB],
        /row-level security/i
      );
      await expectQueryRejected(
        client,
        "select filename from schema_migrations",
        [],
        /permission denied/i
      );

      await client.query("rollback");
      await client.query("reset role");
    });
  }, 60_000);
});
