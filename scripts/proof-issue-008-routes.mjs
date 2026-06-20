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
const outputPath = new URL("../docs/reviews/2026-06-20-issue-008-route-proof.json", import.meta.url);
const listScreenshotPath = new URL("../docs/reviews/2026-06-20-issue-008-route-list-detail.png", import.meta.url);
const editorScreenshotPath = new URL("../docs/reviews/2026-06-20-issue-008-target-editor.png", import.meta.url);
const fieldsScreenshotPath = new URL("../docs/reviews/2026-06-20-issue-008-route-fields.png", import.meta.url);
const port = 3028;
const baseUrl = `http://127.0.0.1:${port}`;

const targetTypes = ["web_inbox", "slack", "sms", "jira", "linear", "email", "github", "webhook", "local_terminal"];
const integrationProviderByTarget = {
  slack: "slack",
  sms: "twilio",
  jira: "jira",
  linear: "linear",
  email: "email",
  github: "github",
  webhook: "webhook"
};

async function docker(args) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function startPostgres() {
  const name = `hookwire-route-proof-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_route_proof",
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

  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${match[1]}/hookwire_route_proof`;
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

async function seedRouteGraph(databaseUrl) {
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
      values ('admin@acme.dev', 'Admin'), ('maya@acme.dev', 'Maya'), ('owner@globex.dev', 'Globex Owner')
      returning id, email
    `);
    const admin = userRows.find((row) => row.email === "admin@acme.dev").id;
    const maya = userRows.find((row) => row.email === "maya@acme.dev").id;
    const otherOrgOwner = userRows.find((row) => row.email === "owner@globex.dev").id;

    await client.query(
      `
        insert into memberships (organization_id, user_id, role)
        values ($1, $2, 'admin'), ($1, $3, 'member'), ($4, $5, 'owner')
      `,
      [organizationId, admin, maya, otherOrganizationId, otherOrgOwner]
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
        values ($1, 'Engineering reviewers', 'Default group'), ($1, 'Release on-call', 'On-call owners')
        returning id, name
      `,
      [organizationId]
    );
    const engineeringGroupId = groupRows.find((row) => row.name === "Engineering reviewers").id;
    const releaseGroupId = groupRows.find((row) => row.name === "Release on-call").id;
    await client.query(
      `
        insert into approval_group_members (organization_id, approval_group_id, user_id, role)
        values ($1, $2, $4, 'manager'), ($1, $3, $4, 'member')
      `,
      [organizationId, engineeringGroupId, releaseGroupId, maya]
    );
    await client.query(
      `
        insert into on_call_assignments (organization_id, approval_group_id, user_id, starts_at, source)
        values ($1, $2, $3, now() - interval '2 hours', 'manual')
      `,
      [organizationId, releaseGroupId, maya]
    );

    const integrations = {};
    for (const [provider, name] of [
      ["slack", "Slack workspace"],
      ["twilio", "SMS sender"],
      ["jira", "Jira site"],
      ["linear", "Linear workspace"],
      ["email", "Email relay"],
      ["github", "GitHub org"],
      ["webhook", "Webhook endpoint"]
    ]) {
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

    const { rows: routeRows } = await client.query(
      `
        insert into routes (organization_id, name, description, approvals_required, timeout_seconds)
        values
          ($1, 'Web inbox', 'Browser approval queue', 1, 900),
          ($1, 'Fallback terminal', 'Local terminal fallback', 1, 300),
          ($1, 'Provider matrix', 'All modeled provider targets', 2, 600),
          ($2, 'Globex route', 'Other tenant route', 1, 900)
        returning id, organization_id, name
      `,
      [organizationId, otherOrganizationId]
    );
    const webRouteId = routeRows.find((row) => row.name === "Web inbox").id;
    const fallbackRouteId = routeRows.find((row) => row.name === "Fallback terminal").id;
    const providerMatrixRouteId = routeRows.find((row) => row.name === "Provider matrix").id;
    const otherRouteId = routeRows.find((row) => row.name === "Globex route").id;
    await client.query("update routes set fallback_route_id = $1 where organization_id = $2 and id = $3", [
      fallbackRouteId,
      organizationId,
      webRouteId
    ]);

    for (let index = 0; index < targetTypes.length; index += 1) {
      const targetType = targetTypes[index];
      const provider = integrationProviderByTarget[targetType];
      const recipientKind = targetType === "local_terminal" ? "system" : index % 2 === 0 ? "group" : "on_call";
      await client.query(
        `
          insert into route_targets (
            organization_id, route_id, target_type, integration_id, approval_group_id, config_json, priority
          )
          values ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          organizationId,
          providerMatrixRouteId,
          targetType,
          provider ? integrations[provider] : null,
          recipientKind === "system" ? null : recipientKind === "group" ? engineeringGroupId : releaseGroupId,
          JSON.stringify({
            providerStatus: targetType === "web_inbox" || targetType === "local_terminal" ? "active" : "modeled",
            recipientKind
          }),
          (index + 1) * 10
        ]
      );
    }

    const { rows: policyRows } = await client.query(
      `
        insert into policies (organization_id, project_id, name, status, default_decision, created_by_user_id)
        values ($1, $2, 'Route reference guard', 'active', 'ask', $3)
        returning id
      `,
      [organizationId, projectId, admin]
    );
    await client.query(
      `
        insert into policy_rules (organization_id, policy_id, name, priority, matcher_json, decision, route_id)
        values ($1, $2, 'Route config writes', 10, '{"operation":"write_file"}'::jsonb, 'route', $3)
      `,
      [organizationId, policyRows[0].id, webRouteId]
    );

    return {
      groupIds: {
        engineering: engineeringGroupId,
        release: releaseGroupId
      },
      organizationId,
      otherOrganizationId,
      otherRouteId,
      projectId,
      routeIds: {
        fallback: fallbackRouteId,
        providerMatrix: providerMatrixRouteId,
        webInbox: webRouteId
      },
      users: {
        admin,
        maya,
        otherOrgOwner
      }
    };
  });
}

async function queryProof(databaseUrl, graph) {
  const acme = await withTenantClient(databaseUrl, graph.organizationId, async (client) => {
    const { rows: routes } = await client.query(
      "select id, name, approvals_required, timeout_seconds, fallback_route_id, enabled from routes order by name"
    );
    const { rows: targets } = await client.query(
      `
        select
          rt.target_type,
          rt.priority,
          rt.enabled,
          rt.config_json,
          r.name as route_name,
          i.provider as integration_provider,
          i.status as integration_status,
          ag.name as approval_group_name,
          on_call_user.name as current_on_call_user_name
        from route_targets rt
        join routes r on r.organization_id = rt.organization_id and r.id = rt.route_id
        left join integrations i on i.organization_id = rt.organization_id and i.id = rt.integration_id
        left join approval_groups ag on ag.organization_id = rt.organization_id and ag.id = rt.approval_group_id
        left join lateral (
          select users.name
          from on_call_assignments assignments
          join users on users.id = assignments.user_id
          where assignments.organization_id = rt.organization_id
            and assignments.approval_group_id = rt.approval_group_id
            and assignments.starts_at <= now()
            and (assignments.ends_at is null or assignments.ends_at > now())
          order by assignments.starts_at desc
          limit 1
        ) on_call_user on true
        order by rt.priority
      `
    );
    const { rows: policyRouteReferences } = await client.query(
      "select name, decision, route_id from policy_rules where route_id = $1",
      [graph.routeIds.webInbox]
    );
    const { rows: globexDirectRlsProbe } = await client.query("select id from routes where id = $1", [graph.otherRouteId]);

    return {
      policyRouteReferences,
      routes,
      targets,
      globexDirectRlsProbe
    };
  });

  return { acme };
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
      const response = await fetch(`${baseUrl}/routes`);
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

  await page.goto(`${baseUrl}/routes`);
  await page.screenshot({ fullPage: true, path: fileURLToPath(listScreenshotPath) });

  const routeForm = page.getByRole("form", { name: "Route settings" });
  await routeForm.getByLabel("Approvals required").fill("2");
  await routeForm.getByLabel("Timeout seconds").fill("1200");
  await routeForm.getByLabel("Fallback route").selectOption("route-local-terminal");
  await routeForm.getByRole("button", { name: "Save route" }).click();
  await page.screenshot({ fullPage: true, path: fileURLToPath(fieldsScreenshotPath) });

  const targetEditor = page.getByRole("form", { name: "Target editor" });
  await targetEditor.getByLabel("Target type").selectOption("web_inbox");
  await targetEditor.getByLabel("Approval group").selectOption("group-engineering");
  await targetEditor.getByLabel("Recipient mode").selectOption("group");
  await targetEditor.getByLabel("Target priority").fill("5");
  await page.screenshot({ fullPage: true, path: fileURLToPath(editorScreenshotPath) });
  await browser.close();

  return {
    consoleMessages,
    routeFieldsScreenshot: fileURLToPath(fieldsScreenshotPath),
    routeListDetailScreenshot: fileURLToPath(listScreenshotPath),
    targetEditorScreenshot: fileURLToPath(editorScreenshotPath)
  };
}

async function main() {
  const postgres = await startPostgres();
  let nextServer;
  try {
    await resetDatabase(postgres.databaseUrl);
    await migrate(postgres.databaseUrl);
    const graph = await seedRouteGraph(postgres.databaseUrl);
    const queryOutput = await queryProof(postgres.databaseUrl, graph);

    await buildNext();
    nextServer = startNext();
    await waitForServer(nextServer.logs);
    const screenshotProof = await captureScreenshots();

    const proof = {
      issue: "008-route-integration-config",
      generatedAt: new Date().toISOString(),
      targetTypes,
      routeIds: graph.routeIds,
      groupIds: graph.groupIds,
      queryProof: queryOutput,
      screenshotProof
    };
    await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, outputPath: fileURLToPath(outputPath), routeIds: graph.routeIds }));
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
