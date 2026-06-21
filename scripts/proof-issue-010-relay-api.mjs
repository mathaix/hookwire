import { execFile, spawn } from "node:child_process";
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomUUID,
  sign
} from "node:crypto";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import pg from "pg";
import { migrate, resetDatabase } from "../packages/db/src/migrate.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;
const outputPath = new URL("../docs/reviews/2026-06-20-issue-010-relay-api-proof.json", import.meta.url);
const port = 3030;
const baseUrl = `http://127.0.0.1:${port}`;
const internalApiSecret = "issue-010-proof-secret";
const fixedNow = new Date("2026-06-20T18:30:00.000Z");

async function docker(args) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function startPostgres() {
  const name = `hookwire-relay-proof-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_relay_proof",
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

  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${match[1]}/hookwire_relay_proof`;
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

async function seedRelayGraph(databaseUrl) {
  return withClient(databaseUrl, async (client) => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    const keyFingerprint = createHash("sha256").update(publicKeyPem).digest("hex");

    const { rows: orgRows } = await client.query(`
      insert into organizations (name, slug)
      values ('Acme Engineering', 'acme-engineering')
      returning id
    `);
    const organizationId = orgRows[0].id;

    const { rows: userRows } = await client.query(`
      insert into users (email, name)
      values ('maya@acme.dev', 'Maya W.')
      returning id
    `);
    const admin = userRows[0].id;
    await client.query(
      "insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')",
      [organizationId, admin]
    );

    const { rows: projectRows } = await client.query(
      `
        insert into projects (organization_id, name, slug, repo_provider, repo_owner, repo_name)
        values
          ($1, 'hookwire/web', 'hookwire-web', 'github', 'mathaix', 'hookwire'),
          ($1, 'hookwire/other', 'hookwire-other', 'github', 'mathaix', 'hookwire-other')
        returning id, slug
      `,
      [organizationId]
    );
    const projectId = projectRows.find((row) => row.slug === "hookwire-web").id;
    const otherProjectId = projectRows.find((row) => row.slug === "hookwire-other").id;

    const { rows: routeRows } = await client.query(
      `
        insert into routes (organization_id, name, approvals_required, timeout_seconds)
        values ($1, 'Relay proof route', 1, 900)
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
        values ($1, $2, $3, 'codex', $4, $4, 'relay-proof-machine')
        returning id
      `,
      [organizationId, projectId, agentToolId, admin]
    );
    const agentInstallationId = installationRows[0].id;

    const { rows: credentialRows } = await client.query(
      `
        insert into installation_credentials (
          organization_id, project_id, agent_installation_id, public_key, key_fingerprint
        )
        values ($1, $2, $3, $4, $5)
        returning id
      `,
      [organizationId, projectId, agentInstallationId, publicKeyPem, keyFingerprint]
    );
    const credentialId = credentialRows[0].id;

    const { rows: sessionRows } = await client.query(
      `
        insert into agent_sessions (
          organization_id, project_id, agent_tool_id, agent_installation_id, agent_type, external_session_id,
          started_by_user_id
        )
        values ($1, $2, $3, $4, 'codex', 'codex-relay-proof', $5)
        returning id
      `,
      [organizationId, projectId, agentToolId, agentInstallationId, admin]
    );

    return {
      agentInstallationId,
      agentSessionId: sessionRows[0].id,
      agentToolId,
      credentialId,
      organizationId,
      otherProjectId,
      privateKey,
      projectId,
      routeId,
      users: { admin }
    };
  });
}

async function buildNext(databaseUrl) {
  await execFileAsync("npx", ["next", "build", "apps/web"], {
    env: proofEnv(databaseUrl),
    maxBuffer: 1024 * 1024 * 20
  });
}

function startNext(databaseUrl) {
  const child = spawn(
    "npx",
    ["next", "start", "apps/web", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      env: proofEnv(databaseUrl),
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  return { child, logs };
}

function proofEnv(databaseUrl) {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    HOOKWIRE_DATABASE_ROLE: "hookwire_app",
    HOOKWIRE_INTERNAL_API_SECRET: internalApiSecret,
    HOOKWIRE_RELAY_TEST_NOW: fixedNow.toISOString()
  };
}

async function waitForServer(logs) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < 20_000) {
    try {
      const response = await fetch(baseUrl);
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

function relayApprovalBody(graph, overrides = {}) {
  return {
    approval: {
      actionSummary: overrides.actionSummary ?? "Run production deploy",
      expiresAt: "2099-06-20T18:45:00.000Z",
      requestedByAgent: "codex-relay"
    },
    agentInstallationId: graph.agentInstallationId,
    agentSessionId: graph.agentSessionId,
    hookEvent: {
      eventType: "PreToolUse",
      operation: "deploy",
      redactedPayload: {
        fields: {
          command: "npm run deploy -- --target production",
          environment: "[REDACTED]"
        },
        redacted: true,
        summary: "Deploy command with environment values redacted"
      },
      riskLevel: "high",
      toolName: "Bash"
    },
    projectId: graph.projectId,
    routeId: graph.routeId,
    ...overrides
  };
}

async function postRelayApproval(graph, options = {}) {
  const path = "/api/relay/approvals";
  const body = JSON.stringify(options.body ?? relayApprovalBody(graph, options.bodyOverrides));
  const headers = options.unsigned
    ? { "content-type": "application/json" }
    : signedRelayHeaders({
        body,
        keyId: graph.credentialId,
        method: "POST",
        nonce: options.nonce,
        path,
        privateKey: options.privateKey ?? graph.privateKey,
        timestamp: options.timestamp
      });
  const response = await fetch(`${baseUrl}${path}`, {
    body,
    headers,
    method: "POST"
  });

  return responseRecord(response, await response.json());
}

async function getRelayDecision(graph, approvalRequestId) {
  const path = `/api/relay/approvals/${approvalRequestId}/decision`;
  const headers = signedRelayHeaders({
    body: "",
    keyId: graph.credentialId,
    method: "GET",
    path,
    privateKey: graph.privateKey
  });
  const response = await fetch(`${baseUrl}${path}`, {
    headers,
    method: "GET"
  });

  return responseRecord(response, await response.json());
}

async function postWebDecision(path, graph, body = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-hookwire-identity-signature": signIdentity(graph.organizationId, graph.users.admin),
      "x-hookwire-organization-id": graph.organizationId,
      "x-hookwire-user-id": graph.users.admin
    },
    method: "POST"
  });

  return responseRecord(response, await response.json());
}

function responseRecord(response, json) {
  return {
    json,
    status: response.status
  };
}

function signIdentity(organizationId, userId) {
  return createHmac("sha256", internalApiSecret).update(`${organizationId}:${userId}`).digest("hex");
}

function signedRelayHeaders(input) {
  const timestamp = input.timestamp ?? fixedNow.toISOString();
  const nonce = input.nonce ?? randomUUID();
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  const canonical = canonicalRelayMessage({
    bodyHash,
    keyId: input.keyId,
    method: input.method,
    nonce,
    path: input.path,
    timestamp
  });
  const signature = sign(null, Buffer.from(canonical), input.privateKey).toString("base64");

  return {
    "content-type": "application/json",
    "x-hookwire-body-sha256": bodyHash,
    "x-hookwire-key-id": input.keyId,
    "x-hookwire-nonce": nonce,
    "x-hookwire-signature": signature,
    "x-hookwire-timestamp": timestamp
  };
}

function canonicalRelayMessage(input) {
  return [
    "hookwire-relay-v1",
    input.method.toUpperCase(),
    input.path,
    input.keyId,
    input.timestamp,
    input.nonce,
    input.bodyHash
  ].join("\n");
}

async function queryProof(databaseUrl, graph, approvalIds) {
  return withClient(databaseUrl, async (client) => {
    const { rows: requests } = await client.query(
      `
        select
          ar.id,
          ar.organization_id,
          ar.project_id,
          ar.agent_tool_id,
          ar.agent_installation_id,
          ar.agent_session_id,
          ar.hook_event_id,
          ar.route_id,
          ar.status,
          ar.risk_level,
          ar.redacted_payload_json,
          he.event_type,
          he.tool_name,
          he.operation,
          he.payload_redacted
        from approval_requests ar
        join hook_events he on he.organization_id = ar.organization_id and he.id = ar.hook_event_id
        where ar.id = any($1::uuid[])
        order by ar.created_at
      `,
      [approvalIds]
    );
    const { rows: decisions } = await client.query(
      `
        select approval_request_id, decision, scope, reason, source
        from approval_decisions
        where approval_request_id = any($1::uuid[])
        order by created_at
      `,
      [approvalIds]
    );
    const { rows: credentialRows } = await client.query(
      `
        select id, organization_id, project_id, agent_installation_id, status, last_used_at is not null as used,
               last_nonce_seen_at is not null as saw_nonce
        from installation_credentials
        where id = $1
      `,
      [graph.credentialId]
    );
    const { rows: nonceRows } = await client.query(
      `
        select count(*)::int as nonce_count
        from relay_request_nonces
        where installation_credential_id = $1
      `,
      [graph.credentialId]
    );

    return {
      credential: credentialRows[0],
      decisions,
      nonceCount: nonceRows[0].nonce_count,
      requests
    };
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  let containerId;
  let server;

  try {
    const postgres = await startPostgres();
    containerId = postgres.containerId;
    const { databaseUrl } = postgres;
    await resetDatabase(databaseUrl);
    await migrate(databaseUrl);
    const graph = await seedRelayGraph(databaseUrl);
    await buildNext(databaseUrl);
    server = startNext(databaseUrl);
    await waitForServer(server.logs);

    const unsignedCreate = await postRelayApproval(graph, { unsigned: true });
    const invalidSignatureKeyPair = generateKeyPairSync("ed25519");
    const invalidSignatureCreate = await postRelayApproval(graph, { privateKey: invalidSignatureKeyPair.privateKey });
    const staleTimestampCreate = await postRelayApproval(graph, { timestamp: "2026-06-20T18:20:00.000Z" });
    const wrongProjectCreate = await postRelayApproval(graph, {
      body: relayApprovalBody(graph, { projectId: graph.otherProjectId })
    });

    const replayNonce = randomUUID();
    const replayFirst = await postRelayApproval(graph, { bodyOverrides: { actionSummary: "Replay first" }, nonce: replayNonce });
    const replaySecond = await postRelayApproval(graph, { bodyOverrides: { actionSummary: "Replay second" }, nonce: replayNonce });

    const approveCreate = await postRelayApproval(graph, { bodyOverrides: { actionSummary: "Approve proof request" } });
    const pendingDecision = await getRelayDecision(graph, approveCreate.json.approvalRequestId);
    const approveDecision = await postWebDecision(
      `/api/approvals/${approveCreate.json.approvalRequestId}/approve`,
      graph,
      { scope: "once" }
    );
    const approvedDecision = await getRelayDecision(graph, approveCreate.json.approvalRequestId);

    const denyCreate = await postRelayApproval(graph, { bodyOverrides: { actionSummary: "Deny proof request" } });
    const denyDecision = await postWebDecision(
      `/api/approvals/${denyCreate.json.approvalRequestId}/deny`,
      graph,
      { reason: "Route requires manual proof review", scope: "session" }
    );
    const deniedDecision = await getRelayDecision(graph, denyCreate.json.approvalRequestId);

    await withClient(databaseUrl, async (client) => {
      await client.query("update installation_credentials set status = 'revoked' where id = $1", [graph.credentialId]);
    });
    const revokedCredentialCreate = await postRelayApproval(graph, { bodyOverrides: { actionSummary: "Revoked proof request" } });

    const approvalIds = [
      replayFirst.json.approvalRequestId,
      approveCreate.json.approvalRequestId,
      denyCreate.json.approvalRequestId
    ];
    const dbProof = await queryProof(databaseUrl, graph, approvalIds);
    const sampleBody = JSON.stringify(relayApprovalBody(graph, { actionSummary: "Sample signed request context" }));
    const sampleHeaders = signedRelayHeaders({
      body: sampleBody,
      keyId: graph.credentialId,
      method: "POST",
      path: "/api/relay/approvals",
      privateKey: graph.privateKey
    });

    assert(unsignedCreate.status === 401, "unsigned create should be rejected");
    assert(invalidSignatureCreate.status === 401, "invalid signature create should be rejected");
    assert(staleTimestampCreate.status === 401, "stale timestamp create should be rejected");
    assert(wrongProjectCreate.status === 403, "wrong project create should be rejected");
    assert(replayFirst.status === 201, "first nonce use should create a request");
    assert(replaySecond.status === 409, "replayed nonce should be rejected");
    assert(approveCreate.status === 201, "approve create should succeed");
    assert(pendingDecision.status === 200 && pendingDecision.json.status === "pending", "decision should start pending");
    assert(approveDecision.status === 200, "web approve should succeed");
    assert(approvedDecision.json.status === "approved", "relay should retrieve approved decision");
    assert(denyCreate.status === 201, "deny create should succeed");
    assert(denyDecision.status === 200, "web deny should succeed");
    assert(deniedDecision.json.status === "denied", "relay should retrieve denied decision");
    assert(revokedCredentialCreate.status === 401, "revoked credential should be rejected");
    assert(dbProof.requests.length === 3, "DB proof should include created relay requests");
    assert(dbProof.requests.every((request) => request.organization_id === graph.organizationId), "requests must stay in tenant");
    assert(dbProof.requests.every((request) => request.project_id === graph.projectId), "requests must stay in project");
    assert(dbProof.requests.every((request) => request.agent_installation_id === graph.agentInstallationId), "requests must keep installation binding");
    assert(dbProof.requests.every((request) => request.agent_session_id === graph.agentSessionId), "requests must keep session binding");

    const proof = {
      api: {
        approvedDecision,
        approveCreate,
        approveDecision,
        deniedDecision,
        denyCreate,
        denyDecision,
        invalidSignatureCreate,
        pendingDecision,
        replayFirst,
        replaySecond,
        revokedCredentialCreate,
        staleTimestampCreate,
        unsignedCreate,
        wrongProjectCreate
      },
      database: dbProof,
      signedRequestContext: {
        bodyHash: sampleHeaders["x-hookwire-body-sha256"],
        keyId: sampleHeaders["x-hookwire-key-id"],
        nonce: sampleHeaders["x-hookwire-nonce"],
        signature: "[REDACTED]",
        timestamp: sampleHeaders["x-hookwire-timestamp"]
      }
    };

    await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`Wrote ${outputPath.pathname}`);
    console.log(
      JSON.stringify(
        {
          approveRequestId: approveCreate.json.approvalRequestId,
          denyRequestId: denyCreate.json.approvalRequestId,
          rejectionStatuses: {
            invalidSignature: invalidSignatureCreate.status,
            replayedNonce: replaySecond.status,
            revokedCredential: revokedCredentialCreate.status,
            staleTimestamp: staleTimestampCreate.status,
            unsigned: unsignedCreate.status,
            wrongProject: wrongProjectCreate.status
          }
        },
        null,
        2
      )
    );
  } finally {
    if (server) {
      server.child.kill("SIGTERM");
    }
    if (containerId) {
      await docker(["stop", containerId]).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
