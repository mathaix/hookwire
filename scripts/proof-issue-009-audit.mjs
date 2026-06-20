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
const outputPath = new URL("../docs/reviews/2026-06-20-issue-009-audit-proof.json", import.meta.url);
const timelineScreenshotPath = new URL("../docs/reviews/2026-06-20-issue-009-audit-timeline.png", import.meta.url);
const filtersScreenshotPath = new URL("../docs/reviews/2026-06-20-issue-009-audit-filters.png", import.meta.url);
const detailScreenshotPath = new URL("../docs/reviews/2026-06-20-issue-009-audit-detail.png", import.meta.url);
const port = 3029;
const baseUrl = `http://127.0.0.1:${port}`;

const eventTypes = [
  "approval.requested",
  "approval.approved",
  "policy.changed",
  "route.changed",
  "key.registered",
  "key.revoked",
  "session.claimed",
  "local_override.used"
];
const rawSecretFixtures = ["sk-live-super-secret", "raw-super-token", "ghp_rawgithubtoken"];

async function docker(args) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function startPostgres() {
  const name = `hookwire-audit-proof-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_audit_proof",
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

  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${match[1]}/hookwire_audit_proof`;
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

async function seedAuditGraph(databaseUrl) {
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
      values ('maya@acme.dev', 'Maya'), ('sam@acme.dev', 'Sam')
      returning id, email
    `);
    const maya = userRows.find((row) => row.email === "maya@acme.dev").id;
    const sam = userRows.find((row) => row.email === "sam@acme.dev").id;
    await client.query(
      "insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'member')",
      [organizationId, maya, sam]
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

    const eventRows = [
      ["approval.requested", "relay", null, "approval_request", randomUUID(), { actionSummary: "Write route config", payload: "[REDACTED]" }],
      ["approval.approved", "user", maya, "approval_decision", randomUUID(), { reason: "Reviewed migration" }],
      ["policy.changed", "user", sam, "policy", randomUUID(), { change: "enabled route rule" }],
      ["route.changed", "user", sam, "route", randomUUID(), { targetType: "web_inbox" }],
      ["key.registered", "user", maya, "user_device_key", randomUUID(), { publicKeyFingerprint: "SHA256:audit-key", privateKey: "[REDACTED]" }],
      ["key.revoked", "user", maya, "user_device_key", randomUUID(), { revocationReason: "Device retired" }],
      ["session.claimed", "user", maya, "agent_session", randomUUID(), { source: "manual_claim" }],
      [
        "local_override.used",
        "user",
        maya,
        "local_override",
        null,
        { authorization: "[REDACTED]", command: "deploy --token [REDACTED]", githubToken: "[REDACTED]", reason: "Emergency unblock" }
      ]
    ];

    for (const [eventType, actorType, actorUserId, entityType, entityId, metadata] of eventRows) {
      await client.query(
        `
          insert into audit_events (
            organization_id, project_id, actor_type, actor_user_id,
            event_type, entity_type, entity_id, metadata_json
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [organizationId, projectId, actorType, actorUserId, eventType, entityType, entityId, JSON.stringify(metadata)]
      );
    }

    await client.query(
      "insert into audit_events (organization_id, actor_type, event_type, entity_type, metadata_json) values ($1, 'system', 'policy.changed', 'policy', '{\"tenant\":\"globex\"}'::jsonb)",
      [otherOrganizationId]
    );

    return { organizationId, otherOrganizationId, projectId, users: { maya, sam } };
  });
}

async function queryProof(databaseUrl, graph) {
  return withTenantClient(databaseUrl, graph.organizationId, async (client) => {
    const { rows: events } = await client.query(
      `
        select
          ae.id,
          ae.event_type,
          ae.entity_type,
          ae.actor_type,
          u.name as actor_name,
          p.name as project_name,
          ae.metadata_json
        from audit_events ae
        left join users u on u.id = ae.actor_user_id
        left join projects p on p.organization_id = ae.organization_id and p.id = ae.project_id
        order by ae.event_type
      `
    );
    const { rows: globexDirectRlsProbe } = await client.query("select id from audit_events where metadata_json->>'tenant' = 'globex'");
    const ownAuditId = events[0].id;
    const updateDenied = await expectDenied(client, "update audit_events set metadata_json = '{}'::jsonb where id = $1", [ownAuditId]);
    const deleteDenied = await expectDenied(client, "delete from audit_events where id = $1", [ownAuditId]);

    return { events, globexDirectRlsProbe, appendOnly: { updateDenied, deleteDenied } };
  });
}

async function expectDenied(client, sql, params) {
  await client.query("savepoint expected_denial");
  try {
    await client.query(sql, params);
    return { denied: false };
  } catch (error) {
    return { denied: true, code: error.code, message: error.message };
  } finally {
    await client.query("rollback to savepoint expected_denial");
    await client.query("release savepoint expected_denial");
  }
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
      const response = await fetch(`${baseUrl}/audit`);
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

  await page.goto(`${baseUrl}/audit`);
  await page.screenshot({ fullPage: true, path: fileURLToPath(timelineScreenshotPath) });

  const filters = page.getByRole("form", { name: "Audit filters" });
  await filters.getByLabel("Project").selectOption("project-web");
  await filters.getByLabel("Entity").selectOption("agent_session");
  await filters.getByLabel("User").selectOption("user-maya");
  await page.screenshot({ fullPage: true, path: fileURLToPath(filtersScreenshotPath) });

  await filters.getByLabel("Entity").selectOption("all");
  await page.getByRole("button", { name: /local_override.used/ }).click();
  const detailText = await page.getByTestId("audit-detail").textContent();
  await page.screenshot({ fullPage: true, path: fileURLToPath(detailScreenshotPath) });
  await browser.close();

  return {
    consoleMessages,
    detailScreenshot: fileURLToPath(detailScreenshotPath),
    filtersScreenshot: fileURLToPath(filtersScreenshotPath),
    rawSecretHits: rawSecretFixtures.filter((fixture) => detailText?.includes(fixture)),
    redactedVisible: detailText?.includes("[REDACTED]") ?? false,
    timelineScreenshot: fileURLToPath(timelineScreenshotPath)
  };
}

async function main() {
  const postgres = await startPostgres();
  let nextServer;
  try {
    await resetDatabase(postgres.databaseUrl);
    await migrate(postgres.databaseUrl);
    const graph = await seedAuditGraph(postgres.databaseUrl);
    const queryOutput = await queryProof(postgres.databaseUrl, graph);

    await buildNext();
    nextServer = startNext();
    await waitForServer(nextServer.logs);
    const screenshotProof = await captureScreenshots();
    assertProof(queryOutput, screenshotProof);

    const proof = {
      issue: "009-audit-timeline",
      generatedAt: new Date().toISOString(),
      eventTypes,
      queryProof: queryOutput,
      screenshotProof
    };
    await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, outputPath: fileURLToPath(outputPath), events: queryOutput.events.length }));
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

function assertProof(queryOutput, screenshotProof) {
  const eventTypesInDb = new Set(queryOutput.events.map((event) => event.event_type));
  const missingEventTypes = eventTypes.filter((eventType) => !eventTypesInDb.has(eventType));
  if (missingEventTypes.length > 0) {
    throw new Error(`Missing audit event types in DB proof: ${missingEventTypes.join(", ")}`);
  }
  if (queryOutput.globexDirectRlsProbe.length > 0) {
    throw new Error("RLS probe returned Globex audit rows to the Acme tenant.");
  }
  if (!queryOutput.appendOnly.updateDenied.denied || !queryOutput.appendOnly.deleteDenied.denied) {
    throw new Error("Audit append-only proof did not deny update and delete.");
  }
  const serializedEvents = JSON.stringify(queryOutput.events);
  for (const fixture of rawSecretFixtures) {
    if (serializedEvents.includes(fixture)) {
      throw new Error(`Raw secret fixture leaked into DB proof rows: ${fixture}`);
    }
  }
  if (!serializedEvents.includes("[REDACTED]")) {
    throw new Error("DB proof rows do not include redacted metadata.");
  }
  if (!screenshotProof.redactedVisible || screenshotProof.rawSecretHits.length > 0) {
    throw new Error("Browser redaction proof failed.");
  }
  if (screenshotProof.consoleMessages.length > 0) {
    throw new Error(`Unexpected browser console messages: ${screenshotProof.consoleMessages.join("; ")}`);
  }
}
