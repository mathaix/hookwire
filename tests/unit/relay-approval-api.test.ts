import { execFile } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject
} from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { POST as createApprovalPost } from "../../apps/web/app/api/relay/approvals/route";
import { GET as getDecision } from "../../apps/web/app/api/relay/approvals/[approvalId]/decision/route";
import {
  createRelayApprovalRequest,
  getRelayApprovalDecision
} from "../../apps/web/app/api/relay/approvals/relay-approval-service";
import { recordApprovalDecision } from "../../apps/web/app/api/approvals/decision-service";
import { migrate, resetDatabase } from "../../packages/db/src/migrate.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;

const fixedNow = new Date("2026-06-20T18:30:00.000Z");

async function docker(args: string[]) {
  return execFileAsync("docker", args, {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function startPostgres() {
  const name = `hookwire-relay-api-${randomUUID()}`;
  const { stdout } = await docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=hookwire",
    "-e",
    "POSTGRES_DB=hookwire_relay_api_test",
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

  const databaseUrl = `postgres://postgres:hookwire@127.0.0.1:${match[1]}/hookwire_relay_api_test`;
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

type SeededRelayGraph = {
  agentInstallationId: string;
  agentSessionId: string;
  agentToolId: string;
  credentialId: string;
  otherProjectId: string;
  organizationId: string;
  privateKey: KeyObject;
  projectId: string;
  publicKeyPem: string;
  routeId: string;
  users: {
    admin: string;
  };
};

async function seedRelayGraph(databaseUrl: string): Promise<SeededRelayGraph> {
  return withClient(databaseUrl, async (client) => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    const keyFingerprint = createHash("sha256").update(publicKeyPem).digest("hex");

    const { rows: orgRows } = await client.query(`
      insert into organizations (name, slug)
      values ('Acme Engineering', 'acme-engineering'), ('Globex', 'globex')
      returning id, slug
    `);
    const organizationId = orgRows.find((row) => row.slug === "acme-engineering").id;

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
        values ($1, 'Relay route', 1, 900)
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
        values ($1, $2, $3, 'codex', $4, $4, 'relay-api-machine')
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
        values ($1, $2, $3, $4, 'codex', 'codex-relay-issue-010', $5)
        returning id
      `,
      [organizationId, projectId, agentToolId, agentInstallationId, admin]
    );
    const agentSessionId = sessionRows[0].id;

    return {
      agentInstallationId,
      agentSessionId,
      agentToolId,
      credentialId,
      otherProjectId,
      organizationId,
      privateKey,
      projectId,
      publicKeyPem,
      routeId,
      users: { admin }
    };
  });
}

function relayApprovalBody(graph: SeededRelayGraph, overrides: Record<string, unknown> = {}) {
  return {
    approval: {
      actionSummary: "Run production deploy",
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

async function callCreateRoute(
  graph: SeededRelayGraph,
  options: {
    body?: Record<string, unknown>;
    keyId?: string;
    nonce?: string;
    path?: string;
    privateKey?: KeyObject;
    rawBody?: string;
    headerOverrides?: Record<string, string | undefined>;
    timestamp?: string;
    unsigned?: boolean;
  } = {}
) {
  const path = options.path ?? "/api/relay/approvals";
  const rawBody = options.rawBody ?? JSON.stringify(options.body ?? relayApprovalBody(graph));
  const headers: Record<string, string> = options.unsigned
    ? { "content-type": "application/json" }
    : signedRelayHeaders({
        body: rawBody,
        keyId: options.keyId ?? graph.credentialId,
        method: "POST",
        nonce: options.nonce,
        path,
        privateKey: options.privateKey ?? graph.privateKey,
        timestamp: options.timestamp
      });
  for (const [key, value] of Object.entries(options.headerOverrides ?? {})) {
    if (value === undefined) {
      delete headers[key];
    } else {
      headers[key] = value;
    }
  }

  const request = new Request(`http://localhost${path}`, {
    body: rawBody,
    headers,
    method: "POST"
  });
  const response = await createApprovalPost(request);
  const json = await response.json();

  return { json, response };
}

async function callDecisionRoute(
  graph: SeededRelayGraph,
  approvalRequestId: string,
  options: {
    keyId?: string;
    nonce?: string;
    path?: string;
    privateKey?: KeyObject;
    timestamp?: string;
    unsigned?: boolean;
  } = {}
) {
  const path = options.path ?? `/api/relay/approvals/${approvalRequestId}/decision`;
  const headers = options.unsigned
    ? {}
    : signedRelayHeaders({
        body: "",
        keyId: options.keyId ?? graph.credentialId,
        method: "GET",
        nonce: options.nonce,
        path,
        privateKey: options.privateKey ?? graph.privateKey,
        timestamp: options.timestamp
      });

  const request = new Request(`http://localhost${path}`, {
    headers,
    method: "GET"
  });
  const response = await getDecision(request, { params: Promise.resolve({ approvalId: approvalRequestId }) });
  const json = await response.json();

  return { json, response };
}

function signedRelayHeaders(input: {
  body: string;
  keyId: string;
  method: string;
  nonce?: string;
  path: string;
  privateKey: KeyObject;
  timestamp?: string;
}) {
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

function canonicalRelayMessage(input: {
  bodyHash: string;
  keyId: string;
  method: string;
  nonce: string;
  path: string;
  timestamp: string;
}) {
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

async function queryCreatedRequest(databaseUrl: string, approvalRequestId: string) {
  return withClient(databaseUrl, async (client) => {
    const { rows } = await client.query(
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
          ar.requested_by_agent,
          ar.action_summary,
          ar.redacted_payload_json,
          he.event_type,
          he.tool_name,
          he.operation,
          he.payload_redacted
        from approval_requests ar
        join hook_events he on he.organization_id = ar.organization_id and he.id = ar.hook_event_id
        where ar.id = $1
      `,
      [approvalRequestId]
    );
    return rows[0];
  });
}

async function setCredentialStatus(databaseUrl: string, credentialId: string, status: string) {
  await withClient(databaseUrl, async (client) => {
    await client.query("update installation_credentials set status = $1 where id = $2", [status, credentialId]);
  });
}

async function expireCredential(databaseUrl: string, credentialId: string) {
  await withClient(databaseUrl, async (client) => {
    await client.query("update installation_credentials set expires_at = $1 where id = $2", [
      "2026-06-20T18:29:00.000Z",
      credentialId
    ]);
  });
}

async function setInstallationStatus(databaseUrl: string, installationId: string, status: string) {
  await withClient(databaseUrl, async (client) => {
    await client.query("update agent_installations set status = $1 where id = $2", [status, installationId]);
  });
}

async function setSessionStatus(databaseUrl: string, sessionId: string, status: string) {
  await withClient(databaseUrl, async (client) => {
    await client.query("update agent_sessions set status = $1 where id = $2", [status, sessionId]);
  });
}

async function setRouteEnabled(databaseUrl: string, routeId: string, enabled: boolean) {
  await withClient(databaseUrl, async (client) => {
    await client.query("update routes set enabled = $1 where id = $2", [enabled, routeId]);
  });
}

async function insertExpiredApproval(databaseUrl: string, graph: SeededRelayGraph) {
  return withClient(databaseUrl, async (client) => {
    const { rows: hookRows } = await client.query(
      `
        insert into hook_events (
          organization_id, project_id, agent_session_id, event_type, tool_name, operation, risk_level,
          payload_redacted
        )
        values ($1, $2, $3, 'PreToolUse', 'Bash', 'expired deploy', 'critical', '{"redacted": true}'::jsonb)
        returning id
      `,
      [graph.organizationId, graph.projectId, graph.agentSessionId]
    );
    const { rows } = await client.query(
      `
        insert into approval_requests (
          organization_id, project_id, agent_tool_id, agent_installation_id, agent_session_id, hook_event_id,
          status, risk_level, route_id, requested_by_agent, action_summary, redacted_payload_json, expires_at
        )
        values ($1, $2, $3, $4, $5, $6, 'pending', 'critical', $7, 'codex-relay', 'Expired deploy', '{"redacted": true}'::jsonb, now() - interval '1 minute')
        returning id
      `,
      [
        graph.organizationId,
        graph.projectId,
        graph.agentToolId,
        graph.agentInstallationId,
        graph.agentSessionId,
        hookRows[0].id,
        graph.routeId
      ]
    );
    return rows[0].id as string;
  });
}

describe("relay approval API", () => {
  let containerId: string;
  let databaseUrl: string;
  let graph: SeededRelayGraph;

  beforeAll(async () => {
    const postgres = await startPostgres();
    containerId = postgres.containerId;
    databaseUrl = postgres.databaseUrl;
    process.env.DATABASE_URL = databaseUrl;
    process.env.HOOKWIRE_DATABASE_ROLE = "hookwire_app";
    process.env.HOOKWIRE_RELAY_TEST_NOW = fixedNow.toISOString();
  }, 30_000);

  beforeEach(async () => {
    await resetAndMigrate(databaseUrl);
    graph = await seedRelayGraph(databaseUrl);
  });

  afterAll(async () => {
    delete process.env.HOOKWIRE_RELAY_TEST_NOW;
    if (containerId) {
      await docker(["stop", containerId]).catch(() => {});
    }
  });

  it("creates a pending approval request with signed relay identity bindings", async () => {
    const { json, response } = await callCreateRoute(graph);

    expect(response.status).toBe(201);
    expect(json).toMatchObject({
      agentInstallationId: graph.agentInstallationId,
      agentSessionId: graph.agentSessionId,
      organizationId: graph.organizationId,
      projectId: graph.projectId,
      status: "pending"
    });
    expect(json.approvalRequestId).toEqual(expect.any(String));
    expect(json.hookEventId).toEqual(expect.any(String));

    const created = await queryCreatedRequest(databaseUrl, json.approvalRequestId);
    expect(created).toMatchObject({
      action_summary: "Run production deploy",
      agent_installation_id: graph.agentInstallationId,
      agent_session_id: graph.agentSessionId,
      agent_tool_id: graph.agentToolId,
      event_type: "PreToolUse",
      hook_event_id: json.hookEventId,
      operation: "deploy",
      organization_id: graph.organizationId,
      project_id: graph.projectId,
      requested_by_agent: "codex-relay",
      risk_level: "high",
      route_id: graph.routeId,
      status: "pending",
      tool_name: "Bash"
    });
    expect(created.redacted_payload_json).toMatchObject({
      redacted: true,
      summary: "Deploy command with environment values redacted"
    });
    expect(created.payload_redacted).toMatchObject(created.redacted_payload_json);
  });

  it("rejects unsigned, invalid signature, revoked credential, stale timestamp, replayed nonce, and tenant binding mismatches", async () => {
    const unsigned = await callCreateRoute(graph, { unsigned: true });
    const invalidSignatureKeyPair = generateKeyPairSync("ed25519");
    const invalidSignature = await callCreateRoute(graph, { privateKey: invalidSignatureKeyPair.privateKey });
    const staleTimestamp = await callCreateRoute(graph, { timestamp: "2026-06-20T18:20:00.000Z" });
    const nonce = randomUUID();
    const firstNonceUse = await callCreateRoute(graph, { nonce });
    const replayedNonce = await callCreateRoute(graph, { nonce });
    const wrongProject = await callCreateRoute(graph, {
      body: relayApprovalBody(graph, { projectId: graph.otherProjectId })
    });
    await setCredentialStatus(databaseUrl, graph.credentialId, "revoked");
    const revokedCredential = await callCreateRoute(graph);

    expect(unsigned.response.status).toBe(401);
    expect(unsigned.json).toMatchObject({ code: "missing_relay_signature" });
    expect(invalidSignature.response.status).toBe(401);
    expect(invalidSignature.json).toMatchObject({ code: "invalid_relay_signature" });
    expect(staleTimestamp.response.status).toBe(401);
    expect(staleTimestamp.json).toMatchObject({ code: "stale_relay_timestamp" });
    expect(firstNonceUse.response.status).toBe(201);
    expect(replayedNonce.response.status).toBe(409);
    expect(replayedNonce.json).toMatchObject({ code: "replayed_relay_nonce" });
    expect(wrongProject.response.status).toBe(403);
    expect(wrongProject.json).toMatchObject({ code: "credential_project_mismatch" });
    expect(revokedCredential.response.status).toBe(401);
    expect(revokedCredential.json).toMatchObject({ code: "relay_credential_not_active" });
  });

  it("rejects unregistered installations and unredacted payload envelopes", async () => {
    const unregisteredInstallation = await callCreateRoute(graph, {
      body: relayApprovalBody(graph, { agentInstallationId: randomUUID() })
    });
    const unredactedEnvelope = await callCreateRoute(graph, {
      body: relayApprovalBody(graph, {
        hookEvent: {
          eventType: "PreToolUse",
          operation: "deploy",
          redactedPayload: {
            fields: {
              token: "raw-secret-value"
            },
            summary: "Raw secret was not redacted"
          },
          riskLevel: "high",
          toolName: "Bash"
        }
      })
    });

    expect(unregisteredInstallation.response.status).toBe(403);
    expect(unregisteredInstallation.json).toMatchObject({ code: "credential_installation_mismatch" });
    expect(unredactedEnvelope.response.status).toBe(400);
    expect(unredactedEnvelope.json).toMatchObject({ code: "invalid_redacted_payload" });
  });

  it("rejects malformed auth headers, unknown credentials, expired credentials, and inactive installations", async () => {
    const bodyHashMismatch = await callCreateRoute(graph, {
      headerOverrides: { "x-hookwire-body-sha256": "0".repeat(64) }
    });
    const invalidTimestamp = await callCreateRoute(graph, { timestamp: "not-a-date" });
    const unknownCredential = await callCreateRoute(graph, { keyId: randomUUID() });

    await setInstallationStatus(databaseUrl, graph.agentInstallationId, "disabled");
    const inactiveInstallation = await callCreateRoute(graph);
    await setInstallationStatus(databaseUrl, graph.agentInstallationId, "active");

    await expireCredential(databaseUrl, graph.credentialId);
    const expiredCredential = await callCreateRoute(graph);

    expect(bodyHashMismatch.response.status).toBe(401);
    expect(bodyHashMismatch.json).toMatchObject({ code: "invalid_relay_body_hash" });
    expect(invalidTimestamp.response.status).toBe(401);
    expect(invalidTimestamp.json).toMatchObject({ code: "invalid_relay_timestamp" });
    expect(unknownCredential.response.status).toBe(401);
    expect(unknownCredential.json).toMatchObject({ code: "relay_credential_not_found" });
    expect(inactiveInstallation.response.status).toBe(401);
    expect(inactiveInstallation.json).toMatchObject({ code: "relay_installation_not_active" });
    expect(expiredCredential.response.status).toBe(401);
    expect(expiredCredential.json).toMatchObject({ code: "relay_credential_not_active" });
  });

  it("validates relay request bodies, redaction, risk, and expiration", async () => {
    const invalidJson = await callCreateRoute(graph, { rawBody: "{" });
    const arrayBody = await callCreateRoute(graph, { rawBody: "[]" });
    const invalidRisk = await callCreateRoute(graph, {
      body: relayApprovalBody(graph, {
        hookEvent: {
          eventType: "PreToolUse",
          operation: "deploy",
          redactedPayload: {
            redacted: true,
            summary: "Safe payload"
          },
          riskLevel: "severe",
          toolName: "Bash"
        }
      })
    });
    const rawSecret = await callCreateRoute(graph, {
      body: relayApprovalBody(graph, {
        hookEvent: {
          eventType: "PreToolUse",
          operation: "deploy",
          redactedPayload: {
            fields: {
              apiToken: "raw-secret-value"
            },
            redacted: true,
            summary: "Raw token leaked"
          },
          riskLevel: "high",
          toolName: "Bash"
        }
      })
    });
    const invalidExpiresAt = await callCreateRoute(graph, {
      body: relayApprovalBody(graph, {
        approval: {
          actionSummary: "Invalid expiry",
          expiresAt: "not-a-date",
          requestedByAgent: "codex-relay"
        }
      })
    });
    const pastExpiresAt = await callCreateRoute(graph, {
      body: relayApprovalBody(graph, {
        approval: {
          actionSummary: "Past expiry",
          expiresAt: "2026-06-20T18:20:00.000Z",
          requestedByAgent: "codex-relay"
        }
      })
    });
    const defaultTimeout = await callCreateRoute(graph, {
      body: relayApprovalBody(graph, {
        approval: {
          actionSummary: "Default timeout",
          requestedByAgent: "codex-relay"
        },
        hookEvent: {
          eventType: "PreToolUse",
          redactedPayload: {
            redacted: true,
            summary: "Operation omitted"
          },
          riskLevel: "low",
          toolName: "Read"
        }
      })
    });

    expect(invalidJson.response.status).toBe(400);
    expect(invalidJson.json).toMatchObject({ code: "invalid_json" });
    expect(arrayBody.response.status).toBe(400);
    expect(arrayBody.json).toMatchObject({ code: "invalid_request_body" });
    expect(invalidRisk.response.status).toBe(400);
    expect(invalidRisk.json).toMatchObject({ code: "invalid_risk_level" });
    expect(rawSecret.response.status).toBe(400);
    expect(rawSecret.json).toMatchObject({ code: "invalid_redacted_payload" });
    expect(invalidExpiresAt.response.status).toBe(400);
    expect(invalidExpiresAt.json).toMatchObject({ code: "invalid_expires_at" });
    expect(pastExpiresAt.response.status).toBe(400);
    expect(pastExpiresAt.json).toMatchObject({ code: "invalid_expires_at" });
    expect(defaultTimeout.response.status).toBe(201);
    expect(defaultTimeout.json.expiresAt).toEqual("2026-06-20T18:45:00.000Z");
  });

  it("validates session and route bindings before creating relay approval requests", async () => {
    const missingSession = await callCreateRoute(graph, {
      body: relayApprovalBody(graph, { agentSessionId: randomUUID() })
    });
    const missingRoute = await callCreateRoute(graph, {
      body: relayApprovalBody(graph, { routeId: randomUUID() })
    });

    await setSessionStatus(databaseUrl, graph.agentSessionId, "ended");
    const endedSession = await callCreateRoute(graph);
    await setSessionStatus(databaseUrl, graph.agentSessionId, "idle");
    const idleSession = await callCreateRoute(graph);

    await setRouteEnabled(databaseUrl, graph.routeId, false);
    const disabledRoute = await callCreateRoute(graph);

    expect(missingSession.response.status).toBe(404);
    expect(missingSession.json).toMatchObject({ code: "agent_session_not_found" });
    expect(missingRoute.response.status).toBe(404);
    expect(missingRoute.json).toMatchObject({ code: "route_not_found" });
    expect(endedSession.response.status).toBe(409);
    expect(endedSession.json).toMatchObject({ code: "agent_session_not_active" });
    expect(idleSession.response.status).toBe(201);
    expect(disabledRoute.response.status).toBe(404);
    expect(disabledRoute.json).toMatchObject({ code: "route_not_found" });
  });

  it("supports direct service options and fails closed for missing database and invalid role config", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousTestNow = process.env.HOOKWIRE_RELAY_TEST_NOW;
    const path = "/api/relay/approvals";
    const body = JSON.stringify(relayApprovalBody(graph, {
      approval: {
        actionSummary: "Direct service create",
        expiresAt: "2099-06-20T18:45:00.000Z",
        requestedByAgent: "codex-relay"
      }
    }));
    const serviceHeaders = signedRelayHeaders({
      body,
      keyId: graph.credentialId,
      method: "POST",
      path,
      privateKey: graph.privateKey,
      timestamp: new Date().toISOString()
    });

    try {
      delete process.env.HOOKWIRE_RELAY_TEST_NOW;
      const created = await createRelayApprovalRequest({
        databaseRole: null,
        databaseUrl,
        headers: serviceHeaders,
        method: "POST",
        path,
        rawBody: body
      });
      expect(created).toMatchObject({ status: "pending", projectId: graph.projectId });

      delete process.env.DATABASE_URL;
      await expect(
        createRelayApprovalRequest({
          headers: serviceHeaders,
          method: "POST",
          path,
          rawBody: body
        })
      ).rejects.toMatchObject({ code: "database_not_configured", status: 500 });
      await expect(
        getRelayApprovalDecision({
          approvalRequestId: created.approvalRequestId,
          headers: serviceHeaders,
          method: "GET",
          path: `/api/relay/approvals/${created.approvalRequestId}/decision`,
          rawBody: ""
        })
      ).rejects.toMatchObject({ code: "database_not_configured", status: 500 });

      const invalidRoleBody = JSON.stringify(relayApprovalBody(graph, {
        approval: {
          actionSummary: "Invalid role config",
          expiresAt: "2099-06-20T18:45:00.000Z",
          requestedByAgent: "codex-relay"
        }
      }));
      await expect(
        createRelayApprovalRequest({
          databaseRole: "bad-role",
          databaseUrl,
          headers: signedRelayHeaders({
            body: invalidRoleBody,
            keyId: graph.credentialId,
            method: "POST",
            path,
            privateKey: graph.privateKey
          }),
          method: "POST",
          now: fixedNow,
          path,
          rawBody: invalidRoleBody
        })
      ).rejects.toMatchObject({ code: "invalid_database_role", status: 500 });
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousTestNow) {
        process.env.HOOKWIRE_RELAY_TEST_NOW = previousTestNow;
      } else {
        delete process.env.HOOKWIRE_RELAY_TEST_NOW;
      }
    }
  });

  it("lets relays retrieve pending, approved, denied, and expired decisions", async () => {
    const approveCreate = await callCreateRoute(graph);
    const pending = await callDecisionRoute(graph, approveCreate.json.approvalRequestId);
    await recordApprovalDecision({
      approvalRequestId: approveCreate.json.approvalRequestId,
      databaseUrl,
      decision: "approved",
      organizationId: graph.organizationId,
      userId: graph.users.admin
    });
    const approved = await callDecisionRoute(graph, approveCreate.json.approvalRequestId);

    const denyCreate = await callCreateRoute(graph);
    await recordApprovalDecision({
      approvalRequestId: denyCreate.json.approvalRequestId,
      databaseUrl,
      decision: "denied",
      organizationId: graph.organizationId,
      reason: "Route requires manual review",
      userId: graph.users.admin
    });
    const denied = await callDecisionRoute(graph, denyCreate.json.approvalRequestId);

    const expiredApprovalId = await insertExpiredApproval(databaseUrl, graph);
    const expired = await callDecisionRoute(graph, expiredApprovalId);

    expect(pending.response.status).toBe(200);
    expect(pending.json).toMatchObject({
      approvalRequestId: approveCreate.json.approvalRequestId,
      decision: null,
      status: "pending"
    });
    expect(approved.response.status).toBe(200);
    expect(approved.json).toMatchObject({
      approvalRequestId: approveCreate.json.approvalRequestId,
      decision: "approved",
      status: "approved"
    });
    expect(denied.response.status).toBe(200);
    expect(denied.json).toMatchObject({
      approvalRequestId: denyCreate.json.approvalRequestId,
      decision: "denied",
      reason: "Route requires manual review",
      status: "denied"
    });
    expect(expired.response.status).toBe(200);
    expect(expired.json).toMatchObject({
      approvalRequestId: expiredApprovalId,
      decision: null,
      status: "expired"
    });
  });

  it("requires signed decision polling and prevents credential reuse outside its tenant binding", async () => {
    const created = await callCreateRoute(graph);
    const unsigned = await callDecisionRoute(graph, created.json.approvalRequestId, { unsigned: true });
    const wrongPath = await callDecisionRoute(graph, created.json.approvalRequestId, {
      path: `/api/relay/approvals/${created.json.approvalRequestId}/other`
    });
    const missingRequest = await callDecisionRoute(graph, randomUUID());

    expect(unsigned.response.status).toBe(401);
    expect(unsigned.json).toMatchObject({ code: "missing_relay_signature" });
    expect(wrongPath.response.status).toBe(401);
    expect(wrongPath.json).toMatchObject({ code: "invalid_relay_signature" });
    expect(missingRequest.response.status).toBe(404);
    expect(missingRequest.json).toMatchObject({ code: "approval_request_not_found" });
  });
});
