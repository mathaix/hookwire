import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import {
  addRouteTarget,
  createRouteBuilder,
  getSelectedRoute,
  providerTargetTypes,
  serializeRouteConfig,
  setRouteFallback,
  updateRouteSettings
} from "../../apps/web/app/routes/domain";
import {
  createRoute,
  createRouteTarget,
  deleteRoute,
  disableRoute,
  listRouteConfig,
  updateRoute
} from "../../apps/web/app/routes/route-service";
import { migrate, resetDatabase } from "../../packages/db/src/migrate.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;

const expectedTargetTypes = [
  "web_inbox",
  "slack",
  "sms",
  "jira",
  "linear",
  "email",
  "github",
  "webhook",
  "local_terminal"
] as const;

async function docker(args: string[]) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function startPostgres() {
  const name = `hookwire-routes-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_route_test",
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

  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${match[1]}/hookwire_route_test`;
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

type SeededRouteGraph = {
  groups: {
    engineering: string;
    release: string;
  };
  integrations: Record<string, string>;
  organizationId: string;
  otherOrganizationId: string;
  projectId: string;
  users: {
    admin: string;
    otherOrgOwner: string;
    onCall: string;
    viewer: string;
  };
};

async function seedRouteGraph(databaseUrl: string): Promise<SeededRouteGraph> {
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
        ('admin@acme.dev', 'Admin'),
        ('reviewer@acme.dev', 'Reviewer'),
        ('viewer@acme.dev', 'Viewer'),
        ('owner@globex.dev', 'Globex Owner')
      returning id, email
    `);
    const admin = userRows.find((row) => row.email === "admin@acme.dev").id;
    const onCall = userRows.find((row) => row.email === "reviewer@acme.dev").id;
    const viewer = userRows.find((row) => row.email === "viewer@acme.dev").id;
    const otherOrgOwner = userRows.find((row) => row.email === "owner@globex.dev").id;

    await client.query(
      `
        insert into memberships (organization_id, user_id, role)
        values
          ($1, $2, 'admin'),
          ($1, $3, 'member'),
          ($1, $4, 'viewer'),
          ($5, $6, 'owner')
      `,
      [organizationId, admin, onCall, viewer, otherOrganizationId, otherOrgOwner]
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

    const { rows: groupRows } = await client.query(
      `
        insert into approval_groups (organization_id, name, description)
        values
          ($1, 'Engineering reviewers', 'Default web inbox reviewers'),
          ($1, 'Release on-call', 'On-call release owners')
        returning id, name
      `,
      [organizationId]
    );
    const engineering = groupRows.find((row) => row.name === "Engineering reviewers").id;
    const release = groupRows.find((row) => row.name === "Release on-call").id;

    await client.query(
      `
        insert into approval_group_members (organization_id, approval_group_id, user_id, role)
        values ($1, $2, $4, 'manager'), ($1, $3, $4, 'member')
      `,
      [organizationId, engineering, release, onCall]
    );
    await client.query(
      `
        insert into on_call_assignments (organization_id, approval_group_id, user_id, starts_at, source)
        values ($1, $2, $3, now() - interval '1 hour', 'manual')
      `,
      [organizationId, release, onCall]
    );

    const providerRows = [
      ["slack", "Slack workspace"],
      ["twilio", "SMS sender"],
      ["jira", "Jira site"],
      ["linear", "Linear workspace"],
      ["email", "Email relay"],
      ["github", "GitHub org"],
      ["webhook", "Webhook endpoint"]
    ];
    const integrations: Record<string, string> = {};
    for (const [provider, name] of providerRows) {
      const { rows } = await client.query(
        `
          insert into integrations (organization_id, provider, name, status, created_by_user_id)
          values ($1, $2, $3, 'inactive', $4)
          returning id
        `,
        [organizationId, provider, name, admin]
      );
      integrations[provider] = rows[0].id;
    }

    return {
      groups: { engineering, release },
      integrations,
      organizationId,
      otherOrganizationId,
      projectId,
      users: { admin, onCall, otherOrgOwner, viewer }
    };
  });
}

async function seedReferencedPolicy(databaseUrl: string, graph: SeededRouteGraph, routeId: string) {
  return withClient(databaseUrl, async (client) => {
    const { rows: policies } = await client.query(
      `
        insert into policies (organization_id, project_id, name, status, default_decision, created_by_user_id)
        values ($1, $2, 'Route guard', 'active', 'ask', $3)
        returning id
      `,
      [graph.organizationId, graph.projectId, graph.users.admin]
    );
    await client.query(
      `
        insert into policy_rules (organization_id, policy_id, name, priority, matcher_json, decision, route_id)
        values ($1, $2, 'Route writes', 10, '{"operation":"write_file"}'::jsonb, 'route', $3)
      `,
      [graph.organizationId, policies[0].id, routeId]
    );
  });
}

describe("route integration configuration domain", () => {
  it("models every provider target type without Slack coupling", () => {
    const state = createRouteBuilder();
    const route = getSelectedRoute(state);

    expect(providerTargetTypes).toEqual(expectedTargetTypes);
    expect(route?.name).toBe("Web inbox");

    const withTargets = expectedTargetTypes.reduce(
      (current, targetType, index) =>
        addRouteTarget(current, {
          approvalGroupId: targetType === "local_terminal" ? null : "group-engineering",
          config: {
            providerStatus: targetType === "web_inbox" ? "active" : "modeled",
            recipientKind: targetType === "web_inbox" ? "group" : "on_call"
          },
          integrationId: targetType === "web_inbox" || targetType === "local_terminal" ? null : `integration-${targetType}`,
          priority: (index + 1) * 10,
          targetType
        }),
      state
    );

    expect(new Set(getSelectedRoute(withTargets)!.targets.map((target) => target.targetType))).toEqual(
      new Set(expectedTargetTypes)
    );
    expect(serializeRouteConfig(withTargets).providerMatrix.map((provider) => provider.targetType)).toEqual(expectedTargetTypes);
    const serializedWebRoute = serializeRouteConfig(withTargets).routes.find((configuredRoute) => configuredRoute.id === "route-web-inbox")!;
    expect(serializedWebRoute.targets[0]).toMatchObject({
      config: { providerStatus: "active", recipientKind: "group" },
      targetType: "web_inbox"
    });
  });

  it("updates approvals, timeout, fallback, and prevents fallback cycles", () => {
    const state = createRouteBuilder();
    const withSettings = updateRouteSettings(state, "route-web-inbox", {
      approvalsRequired: 2,
      fallbackRouteId: "route-local-terminal",
      timeoutSeconds: 1200
    });

    expect(getSelectedRoute(withSettings)).toMatchObject({
      approvalsRequired: 2,
      fallbackRouteId: "route-local-terminal",
      timeoutSeconds: 1200
    });
    expect(() => setRouteFallback(withSettings, "route-local-terminal", "route-web-inbox")).toThrow("Fallback cycle detected.");
    expect(() => setRouteFallback(withSettings, "route-web-inbox", "route-web-inbox")).toThrow("A route cannot fall back to itself.");
  });

  it("rejects invalid route and target input in the local builder", () => {
    const state = createRouteBuilder();
    const emptyState = { ...state, routes: [], selectedRouteId: null, selectedTargetId: null };

    expect(addRouteTarget(emptyState, { priority: 10, targetType: "web_inbox" })).toBe(emptyState);
    expect(() => updateRouteSettings(state, "route-web-inbox", { name: "   " })).toThrow("Route name is required.");
    expect(() => updateRouteSettings(state, "route-web-inbox", { approvalsRequired: 0 })).toThrow(
      "Approvals required must be positive."
    );
    expect(() => updateRouteSettings(state, "route-web-inbox", { timeoutSeconds: 0 })).toThrow(
      "Timeout seconds must be positive."
    );
    expect(() =>
      addRouteTarget(state, {
        priority: 0,
        targetType: "web_inbox"
      })
    ).toThrow("Target priority must be positive.");
    expect(() =>
      addRouteTarget(state, {
        priority: 10,
        targetType: "discord" as never
      })
    ).toThrow("Unsupported route target type.");

    const localTargetState = addRouteTarget(state, {
      config: { recipientKind: "system" },
      priority: 90,
      targetType: "local_terminal"
    });
    expect(getSelectedRoute(localTargetState)!.targets.find((target) => target.id === "target-local_terminal-90"))
      .toMatchObject({
        approvalGroupId: null,
        config: { recipientKind: "system" },
        integrationId: null
      });
  });
});

describe("route integration configuration database service", () => {
  let containerId: string;
  let databaseUrl: string;
  let graph: SeededRouteGraph;

  beforeAll(async () => {
    const postgres = await startPostgres();
    containerId = postgres.containerId;
    databaseUrl = postgres.databaseUrl;
    process.env.HOOKWIRE_DATABASE_ROLE = "hookwire_app";
  }, 30_000);

  beforeEach(async () => {
    await resetDatabase(databaseUrl);
    await migrate(databaseUrl);
    graph = await seedRouteGraph(databaseUrl);
  });

  afterAll(async () => {
    if (containerId) {
      await docker(["stop", containerId]).catch(() => {});
    }
  });

  it("creates routes and route targets for every provider type with group and on-call routing", async () => {
    const webRoute = await createRoute({
      approvalsRequired: 1,
      databaseUrl,
      description: "Browser approval queue",
      name: "Web inbox",
      organizationId: graph.organizationId,
      timeoutSeconds: 900,
      userId: graph.users.admin
    });
    const fallbackRoute = await createRoute({
      approvalsRequired: 2,
      databaseUrl,
      description: "Release owners",
      name: "Release on-call",
      organizationId: graph.organizationId,
      timeoutSeconds: 600,
      userId: graph.users.admin
    });
    await updateRoute({
      databaseUrl,
      fallbackRouteId: fallbackRoute.id,
      organizationId: graph.organizationId,
      routeId: webRoute.id,
      timeoutSeconds: 1200,
      userId: graph.users.admin
    });
    await updateRoute({
      approvalsRequired: 2,
      databaseUrl,
      organizationId: graph.organizationId,
      routeId: webRoute.id,
      userId: graph.users.admin
    });

    const targetInputs = expectedTargetTypes.map((targetType, index) => ({
      approvalGroupId: targetType === "local_terminal" ? null : graph.groups[index % 2 === 0 ? "engineering" : "release"],
      config: {
        providerStatus: targetType === "web_inbox" ? "active" : "modeled",
        recipientKind: targetType === "local_terminal" ? "system" : index % 2 === 0 ? "group" : "on_call"
      },
      integrationId:
        targetType === "web_inbox" || targetType === "local_terminal"
          ? null
          : graph.integrations[targetType === "sms" ? "twilio" : targetType],
      priority: (index + 1) * 10,
      targetType
    }));
    for (const target of targetInputs) {
      await createRouteTarget({
        ...target,
        databaseUrl,
        organizationId: graph.organizationId,
        routeId: webRoute.id,
        userId: graph.users.admin
      });
    }

    const config = await listRouteConfig({ databaseUrl, organizationId: graph.organizationId });
    const configuredRoute = config.routes.find((route) => route.id === webRoute.id)!;

    expect(configuredRoute).toMatchObject({
      approvalsRequired: 2,
      enabled: true,
      fallbackRouteId: fallbackRoute.id,
      timeoutSeconds: 1200
    });
    expect(configuredRoute.targets.map((target) => target.targetType)).toEqual(expectedTargetTypes);
    expect(configuredRoute.targets.find((target) => target.targetType === "web_inbox")).toMatchObject({
      approvalGroupName: "Engineering reviewers",
      config: { recipientKind: "group" },
      integrationStatus: null
    });
    expect(configuredRoute.targets.find((target) => target.targetType === "slack")).toMatchObject({
      approvalGroupName: "Release on-call",
      config: { recipientKind: "on_call" },
      currentOnCallUserName: "Reviewer",
      integrationStatus: "inactive"
    });
  });

  it("prevents fallback cycles and protects routes referenced by policy rules", async () => {
    const primary = await createRoute({
      databaseUrl,
      name: "Primary",
      organizationId: graph.organizationId,
      userId: graph.users.admin
    });
    const fallback = await createRoute({
      databaseUrl,
      name: "Fallback",
      organizationId: graph.organizationId,
      userId: graph.users.admin
    });
    await updateRoute({
      databaseUrl,
      fallbackRouteId: fallback.id,
      organizationId: graph.organizationId,
      routeId: primary.id,
      userId: graph.users.admin
    });

    await expect(
      updateRoute({
        databaseUrl,
        fallbackRouteId: primary.id,
        organizationId: graph.organizationId,
        routeId: fallback.id,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "fallback_cycle", status: 400 });
    await expect(
      updateRoute({
        databaseUrl,
        fallbackRouteId: primary.id,
        organizationId: graph.organizationId,
        routeId: primary.id,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "fallback_self", status: 400 });

    await seedReferencedPolicy(databaseUrl, graph, primary.id);
    await expect(
      disableRoute({
        databaseUrl,
        organizationId: graph.organizationId,
        routeId: primary.id,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "route_in_use", status: 409 });
    await expect(
      deleteRoute({
        databaseUrl,
        organizationId: graph.organizationId,
        routeId: primary.id,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "route_in_use", status: 409 });
    await expect(
      deleteRoute({
        databaseUrl,
        organizationId: graph.organizationId,
        routeId: fallback.id,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "route_in_use", status: 409 });

    const unused = await createRoute({
      databaseUrl,
      name: "Unused",
      organizationId: graph.organizationId,
      userId: graph.users.admin
    });
    await expect(
      disableRoute({
        databaseUrl,
        organizationId: graph.organizationId,
        routeId: unused.id,
        userId: graph.users.admin
      })
    ).resolves.toMatchObject({ enabled: false });
    await expect(
      deleteRoute({
        databaseUrl,
        organizationId: graph.organizationId,
        routeId: unused.id,
        userId: graph.users.admin
      })
    ).resolves.toMatchObject({ deleted: true, routeId: unused.id });
  });

  it("rejects unauthorized route edits and keeps tenant rows isolated", async () => {
    await expect(
      createRoute({
        databaseUrl,
        name: "Viewer route",
        organizationId: graph.organizationId,
        userId: graph.users.viewer
      })
    ).rejects.toMatchObject({ code: "unauthorized", status: 403 });
    await expect(
      createRoute({
        databaseUrl,
        name: "Wrong org route",
        organizationId: graph.organizationId,
        userId: graph.users.otherOrgOwner
      })
    ).rejects.toMatchObject({ code: "unauthorized", status: 403 });

    await withClient(databaseUrl, async (client) => {
      const { rows: otherRoutes } = await client.query(
        "insert into routes (organization_id, name) values ($1, 'Globex route') returning id",
        [graph.otherOrganizationId]
      );
      await client.query("begin");
      await client.query('set local role "hookwire_app"');
      await client.query("select set_config('app.current_organization_id', $1, true)", [graph.organizationId]);
      const { rows } = await client.query("select id from routes where id = $1", [otherRoutes[0].id]);
      await client.query("rollback");
      expect(rows).toEqual([]);
    });
  });

  it("rejects invalid route settings and provider target wiring", async () => {
    await expect(
      createRoute({
        databaseUrl,
        name: "   ",
        organizationId: graph.organizationId,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "name_required", status: 400 });
    await expect(
      createRoute({
        approvalsRequired: 0,
        databaseUrl,
        name: "Bad approvals",
        organizationId: graph.organizationId,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "invalid_approvals_required", status: 400 });
    await expect(
      createRoute({
        databaseUrl,
        name: "Bad timeout",
        organizationId: graph.organizationId,
        timeoutSeconds: 0,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "invalid_timeout", status: 400 });
    const route = await createRoute({
      databaseUrl,
      name: "Validation route",
      organizationId: graph.organizationId,
      userId: graph.users.admin
    });
    await expect(
      createRoute({
        databaseUrl,
        name: "Validation route",
        organizationId: graph.organizationId,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "route_name_conflict", status: 409 });
    await expect(
      updateRoute({
        databaseUrl,
        fallbackRouteId: "00000000-0000-0000-0000-000000000000",
        organizationId: graph.organizationId,
        routeId: route.id,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "fallback_not_found", status: 400 });

    await expect(
      createRouteTarget({
        config: { recipientKind: "group" },
        databaseUrl,
        organizationId: graph.organizationId,
        priority: 10,
        routeId: route.id,
        targetType: "slack",
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "approval_group_required", status: 400 });
    await expect(
      createRouteTarget({
        approvalGroupId: "00000000-0000-0000-0000-000000000000",
        config: { recipientKind: "group" },
        databaseUrl,
        organizationId: graph.organizationId,
        priority: 10,
        routeId: route.id,
        targetType: "web_inbox",
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "approval_group_not_found", status: 400 });
    await expect(
      createRouteTarget({
        approvalGroupId: graph.groups.engineering,
        config: { recipientKind: "group" },
        databaseUrl,
        organizationId: graph.organizationId,
        priority: 10,
        routeId: route.id,
        targetType: "slack",
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "integration_required", status: 400 });
    await expect(
      createRouteTarget({
        approvalGroupId: graph.groups.engineering,
        config: { recipientKind: "group" },
        databaseUrl,
        integrationId: "00000000-0000-0000-0000-000000000000",
        organizationId: graph.organizationId,
        priority: 10,
        routeId: route.id,
        targetType: "slack",
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "integration_not_found", status: 400 });
    await expect(
      createRouteTarget({
        approvalGroupId: graph.groups.engineering,
        config: { recipientKind: "group" },
        databaseUrl,
        integrationId: graph.integrations.twilio,
        organizationId: graph.organizationId,
        priority: 10,
        routeId: route.id,
        targetType: "slack",
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "integration_provider_mismatch", status: 400 });
    await expect(
      createRouteTarget({
        approvalGroupId: graph.groups.engineering,
        config: { recipientKind: "invalid" as never },
        databaseUrl,
        organizationId: graph.organizationId,
        priority: 10,
        routeId: route.id,
        targetType: "web_inbox",
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "invalid_recipient_kind", status: 400 });
    await expect(
      createRouteTarget({
        approvalGroupId: graph.groups.engineering,
        config: { recipientKind: "group" },
        databaseUrl,
        organizationId: graph.organizationId,
        priority: 0,
        routeId: route.id,
        targetType: "web_inbox",
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "invalid_priority", status: 400 });

    await createRouteTarget({
      approvalGroupId: graph.groups.engineering,
      config: { recipientKind: "group" },
      databaseUrl,
      organizationId: graph.organizationId,
      priority: 10,
      routeId: route.id,
      targetType: "web_inbox",
      userId: graph.users.admin
    });
    await expect(
      createRouteTarget({
        approvalGroupId: graph.groups.release,
        config: { recipientKind: "on_call" },
        databaseUrl,
        organizationId: graph.organizationId,
        priority: 10,
        routeId: route.id,
        targetType: "web_inbox",
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "target_priority_conflict", status: 409 });
  });

  it("rejects unsafe database configuration", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      await expect(listRouteConfig({ organizationId: graph.organizationId })).rejects.toMatchObject({
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

    await expect(
      listRouteConfig({ databaseRole: "bad-role;", databaseUrl, organizationId: graph.organizationId })
    ).rejects.toMatchObject({ code: "invalid_database_role", status: 500 });
  });
});
