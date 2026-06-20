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
const outputPath = new URL("../docs/reviews/2026-06-20-issue-007-policy-proof.json", import.meta.url);
const creationScreenshotPath = new URL("../docs/reviews/2026-06-20-issue-007-rule-creation.png", import.meta.url);
const routeScreenshotPath = new URL("../docs/reviews/2026-06-20-issue-007-route-override.png", import.meta.url);
const orderingScreenshotPath = new URL("../docs/reviews/2026-06-20-issue-007-rule-ordering.png", import.meta.url);
const port = 3027;
const baseUrl = `http://127.0.0.1:${port}`;

async function docker(args) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function startPostgres() {
  const name = `hookwire-policy-proof-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_policy_proof",
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

  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${match[1]}/hookwire_policy_proof`;
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

async function seedPolicyGraph(databaseUrl) {
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
      values ('admin@acme.dev', 'Admin'), ('viewer@acme.dev', 'Viewer'), ('owner@globex.dev', 'Globex Owner')
      returning id, email
    `);
    const admin = userRows.find((row) => row.email === "admin@acme.dev").id;
    const viewer = userRows.find((row) => row.email === "viewer@acme.dev").id;
    const otherOrgOwner = userRows.find((row) => row.email === "owner@globex.dev").id;

    await client.query(
      `
        insert into memberships (organization_id, user_id, role)
        values ($1, $2, 'admin'), ($1, $3, 'viewer'), ($4, $5, 'owner')
      `,
      [organizationId, admin, viewer, otherOrganizationId, otherOrgOwner]
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
      "insert into project_memberships (organization_id, project_id, user_id, role) values ($1, $2, $3, 'viewer')",
      [organizationId, projectId, viewer]
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
    const onCallRouteId = routeRows.find((row) => row.name === "On-call reviewers").id;

    const { rows: policyRows } = await client.query(
      `
        insert into policies (organization_id, project_id, name, version, status, default_decision, created_by_user_id)
        values ($1, $2, 'Deploy guard', 5, 'active', 'ask', $3)
        returning id
      `,
      [organizationId, projectId, admin]
    );
    const policyId = policyRows[0].id;

    await client.query(
      `
        insert into policy_rules (
          organization_id, policy_id, name, priority, matcher_json, decision, route_id,
          local_override_allowed, require_override_reason, max_scope
        )
        values
          ($1, $2, 'Route guarded config writes', 10, '{"operation":"write_file","pathPattern":".hookwire/**","riskTag":"medium"}'::jsonb, 'route', $3, true, true, 'session'),
          ($1, $2, 'Deny destructive deletes', 20, '{"commandPattern":"^rm\\\\s+-rf\\\\s+/","operation":"shell","riskTag":"critical"}'::jsonb, 'deny', null, false, false, null)
      `,
      [organizationId, policyId, onCallRouteId]
    );

    return {
      organizationId,
      otherOrganizationId,
      policyId,
      projectId,
      routeIds: {
        onCall: onCallRouteId
      },
      users: {
        admin,
        otherOrgOwner,
        viewer
      }
    };
  });
}

async function queryProof(databaseUrl, graph) {
  const acme = await withTenantClient(databaseUrl, graph.organizationId, async (client) => {
    const { rows: policies } = await client.query(
      "select id, name, version, status, default_decision from policies where id = $1",
      [graph.policyId]
    );
    const { rows: rules } = await client.query(
      `
        select name, priority, matcher_json, decision, route_id, local_override_allowed, require_override_reason, max_scope
        from policy_rules
        where policy_id = $1
        order by priority
      `,
      [graph.policyId]
    );
    const { rows: routes } = await client.query("select id, name from routes order by name");
    const { rows: viewerEditProbe } = await client.query(
      `
        select m.role as organization_role, pm.role as project_role
        from memberships m
        left join project_memberships pm on pm.organization_id = m.organization_id and pm.user_id = m.user_id and pm.project_id = $2
        where m.organization_id = $1 and m.user_id = $3
      `,
      [graph.organizationId, graph.projectId, graph.users.viewer]
    );
    const { rows: globexDirectRlsProbe } = await client.query("select id from policies where organization_id = $1", [
      graph.otherOrganizationId
    ]);

    return {
      policies,
      rules,
      routes,
      viewerEditProbe,
      globexDirectRlsProbe,
      serializedBundle: serializeBundle(policies[0], rules, routes)
    };
  });

  return { acme };
}

function serializeBundle(policy, rules, routes) {
  const routeIds = new Set(rules.flatMap((rule) => (rule.route_id ? [rule.route_id] : [])));

  return {
    schemaVersion: 1,
    policyId: policy.id,
    policyName: policy.name,
    version: policy.version,
    defaultDecision: policy.default_decision,
    routes: routes.filter((route) => routeIds.has(route.id)),
    rules: rules.map((rule) => ({
      name: rule.name,
      priority: rule.priority,
      matcher: rule.matcher_json,
      decision: rule.decision,
      routeId: rule.route_id,
      localOverrideAllowed: rule.local_override_allowed,
      requireOverrideReason: rule.require_override_reason,
      maxScope: rule.max_scope
    }))
  };
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
      const response = await fetch(`${baseUrl}/policies`);
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
  const consoleMessages = [];
  page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));

  await page.goto(`${baseUrl}/policies`);
  await page.getByRole("button", { name: "New rule" }).click();
  const editor = page.getByRole("form", { name: "Rule editor" });
  await editor.getByLabel("Rule name").fill("Route deploy approvals");
  await editor.getByLabel("Command prefix").fill("npm run deploy");
  await editor.getByLabel("Operation").selectOption("shell");
  await editor.getByLabel("Path pattern").fill("deploy/**");
  await editor.getByLabel("Risk tag").selectOption("high");
  await editor.getByLabel("Decision").selectOption("route");
  await editor.getByLabel("Route").selectOption("route-on-call");
  await editor.getByLabel("Allow local override").check();
  await editor.getByLabel("Override scope").selectOption("session");
  await editor.getByLabel("Require override reason").check();
  await page.screenshot({ fullPage: true, path: fileURLToPath(creationScreenshotPath) });

  await editor.getByRole("button", { name: "Create rule" }).click();
  await page.screenshot({ fullPage: true, path: fileURLToPath(routeScreenshotPath) });

  await page.getByRole("button", { name: "Move Ask for config writes up" }).click();
  await page.screenshot({ fullPage: true, path: fileURLToPath(orderingScreenshotPath) });
  await browser.close();

  return {
    consoleMessages,
    creationScreenshot: fileURLToPath(creationScreenshotPath),
    orderingScreenshot: fileURLToPath(orderingScreenshotPath),
    routeOverrideScreenshot: fileURLToPath(routeScreenshotPath)
  };
}

async function main() {
  const postgres = await startPostgres();
  let nextServer;
  try {
    await resetDatabase(postgres.databaseUrl);
    await migrate(postgres.databaseUrl);
    const graph = await seedPolicyGraph(postgres.databaseUrl);
    const queryOutput = await queryProof(postgres.databaseUrl, graph);

    await buildNext();
    nextServer = startNext();
    await waitForServer(nextServer.logs);
    const screenshotProof = await captureScreenshots();

    const proof = {
      issue: "007-policy-rule-builder",
      generatedAt: new Date().toISOString(),
      seededPolicyId: graph.policyId,
      routeIds: graph.routeIds,
      queryProof: queryOutput,
      screenshotProof
    };
    await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, outputPath: fileURLToPath(outputPath), seededPolicyId: graph.policyId }));
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
