import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import {
  addPolicyRule,
  createPolicyBuilder,
  evaluatePolicy,
  getSelectedPolicy,
  reorderPolicyRule,
  serializePolicyBundle,
  updatePolicyRule
} from "../../apps/web/app/policies/domain";
import {
  createPolicy,
  createPolicyRule,
  getPolicyBundle,
  reorderPolicyRules,
  updatePolicyRuleRecord
} from "../../apps/web/app/policies/policy-service";
import { migrate, resetDatabase } from "../../packages/db/src/migrate.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;

async function docker(args: string[]) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function startPostgres() {
  const name = `hookwire-policies-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_policy_test",
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

  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${match[1]}/hookwire_policy_test`;
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

type SeededPolicyGraph = {
  organizationId: string;
  otherOrganizationId: string;
  projectId: string;
  routeIds: {
    onCall: string;
    webInbox: string;
  };
  users: {
    admin: string;
    otherOrgOwner: string;
    projectMember: string;
    viewer: string;
  };
};

async function seedPolicyGraph(databaseUrl: string): Promise<SeededPolicyGraph> {
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
        ('member@acme.dev', 'Member'),
        ('viewer@acme.dev', 'Viewer'),
        ('owner@globex.dev', 'Globex Owner')
      returning id, email
    `);
    const admin = userRows.find((row) => row.email === "admin@acme.dev").id;
    const projectMember = userRows.find((row) => row.email === "member@acme.dev").id;
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
      [organizationId, admin, projectMember, viewer, otherOrganizationId, otherOrgOwner]
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

    await client.query(
      `
        insert into project_memberships (organization_id, project_id, user_id, role)
        values ($1, $2, $3, 'member'), ($1, $2, $4, 'viewer')
      `,
      [organizationId, projectId, projectMember, viewer]
    );

    const { rows: routeRows } = await client.query(
      `
        insert into routes (organization_id, name, description, approvals_required, timeout_seconds)
        values
          ($1, 'Web inbox', 'Browser approval queue', 1, 900),
          ($1, 'On-call reviewers', 'Primary on-call route', 1, 600)
        returning id, name
      `,
      [organizationId]
    );

    return {
      organizationId,
      otherOrganizationId,
      projectId,
      routeIds: {
        onCall: routeRows.find((row) => row.name === "On-call reviewers").id,
        webInbox: routeRows.find((row) => row.name === "Web inbox").id
      },
      users: {
        admin,
        otherOrgOwner,
        projectMember,
        viewer
      }
    };
  });
}

async function queryPolicyRows(databaseUrl: string, organizationId: string, policyId: string) {
  return withClient(databaseUrl, async (client) => {
    const { rows: policies } = await client.query(
      "select id, name, version, status, default_decision from policies where organization_id = $1 and id = $2",
      [organizationId, policyId]
    );
    const { rows: rules } = await client.query(
      `
        select name, priority, matcher_json, decision, route_id, local_override_allowed, require_override_reason
        from policy_rules
        where organization_id = $1 and policy_id = $2
        order by priority
      `,
      [organizationId, policyId]
    );

    return { policies, rules };
  });
}

describe("policy rule builder domain", () => {
  it("creates, edits, routes, and reorders policy rules with explicit priority", () => {
    const initial = createPolicyBuilder();
    const selected = getSelectedPolicy(initial);
    expect(selected?.name).toBe("Default write guard");

    const created = addPolicyRule(initial, {
      decision: "route",
      localOverrideAllowed: true,
      matcher: { commandPrefix: "npm run deploy" },
      name: "Route deploys to on-call",
      requireOverrideReason: true,
      routeId: "route-on-call"
    });
    const newRule = getSelectedPolicy(created)!.rules.find((rule) => rule.name === "Route deploys to on-call")!;
    expect(newRule).toMatchObject({
      decision: "route",
      priority: 50,
      requireOverrideReason: true,
      routeId: "route-on-call"
    });

    const edited = updatePolicyRule(created, newRule.id, {
      matcher: { commandPattern: "^npm run deploy(:prod)?$", riskTag: "critical" },
      name: "Route production deploys to on-call"
    });
    expect(getSelectedPolicy(edited)!.rules.find((rule) => rule.id === newRule.id)).toMatchObject({
      matcher: { commandPattern: "^npm run deploy(:prod)?$", riskTag: "critical" },
      name: "Route production deploys to on-call"
    });

    const reordered = reorderPolicyRule(edited, newRule.id, "up");
    expect(getSelectedPolicy(reordered)!.rules.map((rule) => [rule.name, rule.priority])).toEqual([
      ["Deny production deletes", 10],
      ["Ask for config writes", 20],
      ["Allow safe reads", 30],
      ["Route production deploys to on-call", 40],
      ["Route production deploys", 50]
    ]);
  });

  it("matches command prefix, command pattern, operation, path pattern, and risk tag deterministically by priority", () => {
    const policy = getSelectedPolicy(createPolicyBuilder())!;

    expect(
      evaluatePolicy(policy, {
        command: "rm -rf /srv/prod/cache",
        operation: "shell",
        path: "/srv/prod/cache",
        riskTag: "critical"
      })
    ).toMatchObject({ decision: "deny", matchedRuleId: "rule-prod-delete" });
    expect(
      evaluatePolicy(policy, {
        command: "npm run build",
        operation: "shell",
        path: "package.json",
        riskTag: "low"
      })
    ).toMatchObject({ decision: "allow", matchedRuleId: "rule-safe-read" });
    expect(
      evaluatePolicy(policy, {
        command: "python scripts/rewrite_config.py",
        operation: "write_file",
        path: ".hookwire/relay.json",
        riskTag: "medium"
      })
    ).toMatchObject({ decision: "ask", matchedRuleId: "rule-config-write", requireOverrideReason: true });
    expect(
      evaluatePolicy(policy, {
        command: "npm run deploy:prod",
        operation: "shell",
        path: "deploy/prod.sh",
        riskTag: "high"
      })
    ).toMatchObject({ decision: "route", matchedRuleId: "rule-prod-route", routeId: "route-on-call" });
  });

  it("falls back to defaults for non-matches, disabled rules, invalid regexes, and missing selections", () => {
    const builder = createPolicyBuilder();
    const policy = getSelectedPolicy(builder)!;
    const disabledDeletePolicy = {
      ...policy,
      defaultDecision: "allow" as const,
      rules: policy.rules.map((rule) => (rule.id === "rule-prod-delete" ? { ...rule, enabled: false } : rule))
    };

    expect(evaluatePolicy(policy, { command: "pnpm build", operation: "shell", path: "package.json", riskTag: "low" }))
      .toMatchObject({ decision: "ask", matchedRuleId: null });
    expect(evaluatePolicy(policy, { command: "npm run test", operation: "shell", path: "deploy/prod.sh", riskTag: "high" }))
      .toMatchObject({ decision: "ask", matchedRuleId: null });
    expect(evaluatePolicy(policy, { command: "npm run build", operation: "write_file", path: "package.json", riskTag: "low" }))
      .toMatchObject({ decision: "ask", matchedRuleId: null });
    expect(evaluatePolicy(policy, { command: "npm run build", operation: "shell", path: "src/index.ts", riskTag: "low" }))
      .toMatchObject({ decision: "ask", matchedRuleId: null });
    expect(evaluatePolicy(policy, { command: "npm run build", operation: "shell", path: "package.json", riskTag: "medium" }))
      .toMatchObject({ decision: "ask", matchedRuleId: null });
    expect(
      evaluatePolicy(disabledDeletePolicy, {
        command: "rm -rf /srv/prod/cache",
        operation: "shell",
        path: "/srv/prod/cache",
        riskTag: "critical"
      })
    ).toMatchObject({ decision: "allow", matchedRuleId: null });
    expect(
      evaluatePolicy(
        {
          ...policy,
          rules: [
            {
              ...policy.rules[0],
              id: "rule-bad-regex",
              matcher: { commandPattern: "[" }
            }
          ]
        },
        { command: "rm -rf /srv/prod/cache" }
      )
    ).toMatchObject({ decision: "ask", matchedRuleId: null });

    const emptyBuilder = { ...builder, policies: [], selectedPolicyId: null, selectedRuleId: null };
    expect(getSelectedPolicy(emptyBuilder)).toBeNull();
    expect(addPolicyRule(emptyBuilder, { decision: "ask", matcher: { operation: "shell" }, name: "No policy" }))
      .toBe(emptyBuilder);
    expect(updatePolicyRule(emptyBuilder, "missing", { name: "No policy" })).toBe(emptyBuilder);
    expect(reorderPolicyRule(emptyBuilder, "missing", "up")).toBe(emptyBuilder);
  });

  it("keeps ordering deterministic for ties and invalid move requests", () => {
    const builder = createPolicyBuilder();
    const policy = getSelectedPolicy(builder)!;
    const firstRule = policy.rules[0];
    const lastRule = policy.rules.at(-1)!;

    expect(reorderPolicyRule(builder, firstRule.id, "up")).toBe(builder);
    expect(reorderPolicyRule(builder, lastRule.id, "down")).toBe(builder);
    expect(reorderPolicyRule(builder, "missing-rule", "up")).toBe(builder);
    expect(
      serializePolicyBundle(
        {
          ...policy,
          rules: [
            { ...policy.rules[1], id: "rule-b", priority: 10 },
            { ...policy.rules[0], id: "rule-a", priority: 10 }
          ]
        },
        builder.routeOptions
      ).rules.map((rule) => rule.id)
    ).toEqual(["rule-a", "rule-b"]);
  });

  it("requires routes for route decisions and omits disabled route dependencies from bundles", () => {
    const builder = createPolicyBuilder();
    const policy = getSelectedPolicy(builder)!;
    const routeRule = policy.rules.find((rule) => rule.id === "rule-prod-route")!;

    expect(() =>
      addPolicyRule(builder, {
        decision: "route",
        matcher: { commandPrefix: "npm run deploy" },
        name: "Missing route"
      })
    ).toThrow("Route decisions require a route.");
    expect(() =>
      addPolicyRule(builder, {
        decision: "ask",
        matcher: {},
        name: "Match everything by accident"
      })
    ).toThrow("At least one matcher is required.");
    expect(() =>
      addPolicyRule(builder, {
        decision: "ask",
        localOverrideAllowed: true,
        matcher: { operation: "shell" },
        maxScope: "workspace" as never,
        name: "Bad scope"
      })
    ).toThrow("Override scope is invalid.");
    expect(
      updatePolicyRule(builder, routeRule.id, {
        decision: "allow",
        localOverrideAllowed: false,
        matcher: { commandPrefix: "npm run deploy" }
      })
    )
      .toMatchObject({
        policies: [
          expect.objectContaining({
            rules: expect.arrayContaining([
              expect.objectContaining({
                decision: "allow",
                id: routeRule.id,
                maxScope: null,
                requireOverrideReason: false,
                routeId: null
              })
            ])
          })
        ]
      });
    expect(
      serializePolicyBundle(
        {
          ...policy,
          rules: policy.rules.map((rule) => (rule.id === "rule-prod-route" ? { ...rule, enabled: false } : rule))
        },
        builder.routeOptions
      )
    ).toMatchObject({
      routes: [],
      rules: expect.not.arrayContaining([expect.objectContaining({ id: "rule-prod-route" })])
    });
  });

  it("serializes a stable local relay policy bundle sorted by priority", () => {
    const bundle = serializePolicyBundle(getSelectedPolicy(createPolicyBuilder())!, [
      { id: "route-web-inbox", name: "Web inbox" },
      { id: "route-on-call", name: "On-call reviewers" }
    ]);

    expect(bundle).toMatchInlineSnapshot(`
      {
        "defaultDecision": "ask",
        "policyId": "policy-default-write-guard",
        "policyName": "Default write guard",
        "projectId": "project-hookwire-web",
        "routes": [
          {
            "id": "route-on-call",
            "name": "On-call reviewers",
          },
        ],
        "rules": [
          {
            "decision": "deny",
            "enabled": true,
            "id": "rule-prod-delete",
            "localOverrideAllowed": false,
            "matcher": {
              "commandPattern": "^rm\\s+-rf\\s+/",
              "operation": "shell",
              "riskTag": "critical",
            },
            "maxScope": null,
            "name": "Deny production deletes",
            "priority": 10,
            "requireOverrideReason": false,
            "routeId": null,
          },
          {
            "decision": "ask",
            "enabled": true,
            "id": "rule-config-write",
            "localOverrideAllowed": true,
            "matcher": {
              "operation": "write_file",
              "pathPattern": ".hookwire/**",
              "riskTag": "medium",
            },
            "maxScope": "once",
            "name": "Ask for config writes",
            "priority": 20,
            "requireOverrideReason": true,
            "routeId": null,
          },
          {
            "decision": "allow",
            "enabled": true,
            "id": "rule-safe-read",
            "localOverrideAllowed": false,
            "matcher": {
              "commandPrefix": "npm run",
              "operation": "shell",
              "pathPattern": "package.json",
              "riskTag": "low",
            },
            "maxScope": null,
            "name": "Allow safe reads",
            "priority": 30,
            "requireOverrideReason": false,
            "routeId": null,
          },
          {
            "decision": "route",
            "enabled": true,
            "id": "rule-prod-route",
            "localOverrideAllowed": true,
            "matcher": {
              "commandPattern": "^npm run deploy(:prod)?$",
              "operation": "shell",
              "pathPattern": "deploy/**",
              "riskTag": "high",
            },
            "maxScope": "session",
            "name": "Route production deploys",
            "priority": 40,
            "requireOverrideReason": true,
            "routeId": "route-on-call",
          },
        ],
        "schemaVersion": 1,
        "version": 3,
      }
    `);
  });
});

describe("policy rule builder database service", () => {
  let containerId: string;
  let databaseUrl: string;
  let graph: SeededPolicyGraph;

  beforeAll(async () => {
    const postgres = await startPostgres();
    containerId = postgres.containerId;
    databaseUrl = postgres.databaseUrl;
    process.env.HOOKWIRE_DATABASE_ROLE = "hookwire_app";
  }, 30_000);

  beforeEach(async () => {
    await resetDatabase(databaseUrl);
    await migrate(databaseUrl);
    graph = await seedPolicyGraph(databaseUrl);
  });

  afterAll(async () => {
    if (containerId) {
      await docker(["stop", containerId]).catch(() => {});
    }
  });

  it("creates policies and route rules, updates override settings, reorders priorities, and serializes a bundle", async () => {
    const policy = await createPolicy({
      databaseUrl,
      defaultDecision: "ask",
      name: "Deploy guard",
      organizationId: graph.organizationId,
      projectId: graph.projectId,
      userId: graph.users.admin
    });
    const routeRule = await createPolicyRule({
      databaseUrl,
      decision: "route",
      localOverrideAllowed: true,
      matcher: { commandPrefix: "npm run deploy", operation: "shell", riskTag: "high" },
      name: "Route deploy commands",
      organizationId: graph.organizationId,
      policyId: policy.id,
      priority: 20,
      requireOverrideReason: true,
      routeId: graph.routeIds.onCall,
      userId: graph.users.admin
    });
    const denyRule = await createPolicyRule({
      databaseUrl,
      decision: "deny",
      matcher: { commandPattern: "^rm\\s+-rf\\s+/", operation: "shell", riskTag: "critical" },
      name: "Deny destructive deletes",
      organizationId: graph.organizationId,
      policyId: policy.id,
      priority: 10,
      userId: graph.users.admin
    });
    const nonRouteRule = await createPolicyRule({
      databaseUrl,
      decision: "allow",
      matcher: { commandPrefix: "npm run lint" },
      maxScope: "project",
      name: "Allow lint",
      organizationId: graph.organizationId,
      policyId: policy.id,
      priority: 30,
      requireOverrideReason: true,
      routeId: graph.routeIds.onCall,
      userId: graph.users.admin
    });
    const edited = await updatePolicyRuleRecord({
      databaseUrl,
      localOverrideAllowed: true,
      matcher: { pathPattern: ".hookwire/**", operation: "write_file", riskTag: "medium" },
      name: "Route guarded config writes",
      organizationId: graph.organizationId,
      requireOverrideReason: true,
      ruleId: routeRule.id,
      userId: graph.users.projectMember
    });
    const reordered = await reorderPolicyRules({
      databaseUrl,
      organizationId: graph.organizationId,
      orderedRuleIds: [routeRule.id, denyRule.id, nonRouteRule.id],
      policyId: policy.id,
      userId: graph.users.admin
    });
    const bundle = await getPolicyBundle({
      databaseUrl,
      organizationId: graph.organizationId,
      policyId: policy.id
    });
    const rows = await queryPolicyRows(databaseUrl, graph.organizationId, policy.id);

    expect(policy).toMatchObject({ defaultDecision: "ask", name: "Deploy guard", version: 1 });
    expect(routeRule).toMatchObject({ decision: "route", priority: 20, routeId: graph.routeIds.onCall });
    expect(nonRouteRule).toMatchObject({
      decision: "allow",
      maxScope: null,
      requireOverrideReason: false,
      routeId: null
    });
    expect(edited).toMatchObject({
      localOverrideAllowed: true,
      matcher: { pathPattern: ".hookwire/**", operation: "write_file", riskTag: "medium" },
      requireOverrideReason: true
    });
    expect(reordered.map((rule) => [rule.id, rule.priority])).toEqual([
      [routeRule.id, 10],
      [denyRule.id, 20],
      [nonRouteRule.id, 30]
    ]);
    expect(rows.policies[0]).toMatchObject({ version: 6 });
    expect(rows.rules.map((rule) => [rule.name, rule.priority, rule.decision])).toEqual([
      ["Route guarded config writes", 10, "route"],
      ["Deny destructive deletes", 20, "deny"],
      ["Allow lint", 30, "allow"]
    ]);
    expect(bundle).toMatchObject({
      defaultDecision: "ask",
      policyId: policy.id,
      rules: [
        expect.objectContaining({ id: routeRule.id, priority: 10, routeId: graph.routeIds.onCall }),
        expect.objectContaining({ id: denyRule.id, priority: 20, decision: "deny" }),
        expect.objectContaining({
          id: nonRouteRule.id,
          priority: 30,
          decision: "allow",
          maxScope: null,
          requireOverrideReason: false,
          routeId: null
        })
      ],
      version: 6
    });
  });

  it("rejects invalid route rules, duplicate priorities, viewers, and wrong-organization users", async () => {
    const policy = await createPolicy({
      databaseUrl,
      defaultDecision: "ask",
      name: "Write guard",
      organizationId: graph.organizationId,
      projectId: graph.projectId,
      userId: graph.users.admin
    });

    await expect(
      createPolicyRule({
        databaseUrl,
        decision: "route",
        matcher: { commandPrefix: "npm run deploy" },
        name: "Missing route",
        organizationId: graph.organizationId,
        policyId: policy.id,
        priority: 10,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "route_required", status: 400 });
    await createPolicyRule({
      databaseUrl,
      decision: "ask",
      matcher: { operation: "write_file" },
      name: "Ask writes",
      organizationId: graph.organizationId,
      policyId: policy.id,
      priority: 10,
      userId: graph.users.admin
    });
    await expect(
      createPolicyRule({
        databaseUrl,
        decision: "allow",
        matcher: { commandPrefix: "npm run" },
        name: "Duplicate priority",
        organizationId: graph.organizationId,
        policyId: policy.id,
        priority: 10,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "priority_conflict", status: 409 });
    await expect(
      createPolicyRule({
        databaseUrl,
        decision: "allow",
        matcher: { commandPrefix: "npm run" },
        name: "Viewer edit",
        organizationId: graph.organizationId,
        policyId: policy.id,
        priority: 20,
        userId: graph.users.viewer
      })
    ).rejects.toMatchObject({ code: "unauthorized", status: 403 });
    await expect(
      createPolicyRule({
        databaseUrl,
        decision: "allow",
        matcher: { commandPrefix: "npm run" },
        name: "Wrong org edit",
        organizationId: graph.organizationId,
        policyId: policy.id,
        priority: 30,
        userId: graph.users.otherOrgOwner
      })
    ).rejects.toMatchObject({ code: "unauthorized", status: 403 });
  });

  it("rejects invalid policy service inputs and invalid reorder requests", async () => {
    const policy = await createPolicy({
      databaseUrl,
      defaultDecision: "ask",
      name: "Write guard",
      organizationId: graph.organizationId,
      projectId: graph.projectId,
      userId: graph.users.admin
    });

    await expect(
      createPolicyRule({
        databaseUrl,
        decision: "ask",
        matcher: { operation: "shell" },
        name: "   ",
        organizationId: graph.organizationId,
        policyId: policy.id,
        priority: 10,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "name_required", status: 400 });
    await expect(
      createPolicyRule({
        databaseUrl,
        decision: "ask",
        matcher: { operation: "shell" },
        name: "Invalid priority",
        organizationId: graph.organizationId,
        policyId: policy.id,
        priority: 0,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "invalid_priority", status: 400 });
    await expect(
      createPolicyRule({
        databaseUrl,
        decision: "ask",
        matcher: {},
        name: "Empty matcher",
        organizationId: graph.organizationId,
        policyId: policy.id,
        priority: 10,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "matcher_required", status: 400 });
    await expect(
      createPolicyRule({
        databaseUrl,
        decision: "ask",
        localOverrideAllowed: true,
        matcher: { operation: "shell" },
        maxScope: "workspace" as never,
        name: "Invalid scope",
        organizationId: graph.organizationId,
        policyId: policy.id,
        priority: 10,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "invalid_scope", status: 400 });
    await expect(
      reorderPolicyRules({
        databaseUrl,
        orderedRuleIds: ["00000000-0000-0000-0000-000000000000"],
        organizationId: graph.organizationId,
        policyId: policy.id,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "invalid_rule_order", status: 400 });
    await expect(
      getPolicyBundle({
        databaseUrl,
        organizationId: graph.organizationId,
        policyId: "00000000-0000-0000-0000-000000000000"
      })
    ).rejects.toMatchObject({ code: "policy_not_found", status: 404 });
    await expect(
      updatePolicyRuleRecord({
        databaseUrl,
        name: "Missing rule",
        organizationId: graph.organizationId,
        ruleId: "00000000-0000-0000-0000-000000000000",
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "rule_not_found", status: 404 });
  });

  it("rejects duplicate priorities on update and unsafe database configuration", async () => {
    const policy = await createPolicy({
      databaseUrl,
      defaultDecision: "ask",
      name: "Write guard",
      organizationId: graph.organizationId,
      projectId: graph.projectId,
      userId: graph.users.admin
    });
    const firstRule = await createPolicyRule({
      databaseUrl,
      decision: "ask",
      matcher: { operation: "write_file" },
      name: "Ask writes",
      organizationId: graph.organizationId,
      policyId: policy.id,
      priority: 10,
      userId: graph.users.admin
    });
    const secondRule = await createPolicyRule({
      databaseUrl,
      decision: "allow",
      matcher: { commandPrefix: "npm run" },
      name: "Allow npm",
      organizationId: graph.organizationId,
      policyId: policy.id,
      priority: 20,
      userId: graph.users.admin
    });

    await expect(
      updatePolicyRuleRecord({
        databaseUrl,
        organizationId: graph.organizationId,
        priority: firstRule.priority,
        ruleId: secondRule.id,
        userId: graph.users.admin
      })
    ).rejects.toMatchObject({ code: "priority_conflict", status: 409 });
    await expect(
      getPolicyBundle({
        databaseRole: "bad-role;",
        databaseUrl,
        organizationId: graph.organizationId,
        policyId: policy.id
      })
    ).rejects.toMatchObject({ code: "invalid_database_role", status: 500 });
  });

  it("requires a configured database URL", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      await expect(
        getPolicyBundle({
          organizationId: graph.organizationId,
          policyId: "00000000-0000-0000-0000-000000000000"
        })
      ).rejects.toMatchObject({ code: "database_not_configured", status: 500 });
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
