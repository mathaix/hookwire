import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import pg from "pg";

const { Client } = pg;

type PgClient = InstanceType<typeof Client>;

export type RelayApprovalCreateResult = {
  agentInstallationId: string;
  agentSessionId: string;
  approvalRequestId: string;
  expiresAt: string | null;
  hookEventId: string;
  organizationId: string;
  projectId: string;
  status: "pending";
};

export type RelayApprovalDecisionResult = {
  approvalRequestId: string;
  decidedAt: string | null;
  decision: "approved" | "denied" | null;
  decisionId: string | null;
  reason: string | null;
  scope: string | null;
  status: "pending" | "approved" | "denied" | "expired" | "cancelled";
  userId: string | null;
};

type SignedRelayInput = {
  databaseRole?: string | null;
  databaseUrl?: string;
  headers: Headers | Record<string, string | undefined>;
  method: string;
  now?: Date;
  path: string;
  rawBody: string;
};

type CreateApprovalBody = {
  approval: {
    actionSummary: string;
    expiresAt: string | null;
    requestedByAgent: string;
  };
  agentInstallationId: string;
  agentSessionId: string;
  hookEvent: {
    eventType: string;
    operation: string | null;
    redactedPayload: Record<string, unknown>;
    riskLevel: string;
    toolName: string;
  };
  projectId: string;
  routeId: string;
};

type RelayCredential = {
  agent_installation_id: string;
  agent_tool_id: string;
  expires_at: Date | string | null;
  installation_status: string;
  organization_id: string;
  project_id: string;
  public_key: string;
  status: string;
};

type RelayAuthContext = {
  agentInstallationId: string;
  agentToolId: string;
  credentialId: string;
  organizationId: string;
  projectId: string;
};

type RouteRow = {
  id: string;
  timeout_seconds: number;
};

type SessionRow = {
  agent_installation_id: string;
  agent_tool_id: string;
  id: string;
  status: string;
};

type CreatedRequestRow = {
  expires_at: Date | string | null;
  hook_event_id: string;
  id: string;
};

type ApprovalRequestRow = {
  expires_at: Date | string | null;
  id: string;
  is_expired: boolean;
  status: "pending" | "approved" | "denied" | "expired" | "cancelled";
};

type DecisionRow = {
  created_at: Date | string;
  decision: "approved" | "denied";
  id: string;
  reason: string | null;
  scope: string;
  user_id: string;
};

const allowedRiskLevels = new Set(["unknown", "low", "medium", "high", "critical"]);
const relayClockSkewMs = 5 * 60 * 1000;
const relayNonceTtlSeconds = 10 * 60;

export class RelayApprovalApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RelayApprovalApiError";
    this.status = status;
    this.code = code;
  }
}

export async function createRelayApprovalRequest(input: SignedRelayInput): Promise<RelayApprovalCreateResult> {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new RelayApprovalApiError(500, "database_not_configured", "DATABASE_URL is required.");
  }

  const databaseRole = input.databaseRole ?? process.env.HOOKWIRE_DATABASE_ROLE ?? null;
  const now = relayNow(input.now);
  const authHeaders = parseAuthHeaders(input);
  const createBody = parseCreateBody(input.rawBody);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("begin");
    const auth = await verifyRelayAuthentication(client, input, authHeaders, now);
    assertCredentialBindings(auth, createBody);
    await setTenantContext(client, auth.organizationId, databaseRole);
    await insertRelayNonce(client, auth, authHeaders.nonce, now);
    const session = await requireSession(client, auth, createBody.agentSessionId);
    const route = await requireRoute(client, auth.organizationId, createBody.routeId);
    const expiresAt = resolveExpiresAt(createBody.approval.expiresAt, route.timeout_seconds, now);

    const { rows: hookRows } = await client.query<{ id: string }>(
      `
        insert into hook_events (
          organization_id, project_id, agent_session_id, event_type, tool_name, operation, risk_level,
          payload_redacted
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        returning id
      `,
      [
        auth.organizationId,
        auth.projectId,
        session.id,
        createBody.hookEvent.eventType,
        createBody.hookEvent.toolName,
        createBody.hookEvent.operation,
        createBody.hookEvent.riskLevel,
        JSON.stringify(createBody.hookEvent.redactedPayload)
      ]
    );

    const { rows: requestRows } = await client.query<CreatedRequestRow>(
      `
        insert into approval_requests (
          organization_id, project_id, agent_tool_id, agent_installation_id, agent_session_id, hook_event_id,
          status, risk_level, route_id, requested_by_agent, action_summary, redacted_payload_json, expires_at
        )
        values ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11::jsonb, $12)
        returning id, hook_event_id, expires_at
      `,
      [
        auth.organizationId,
        auth.projectId,
        auth.agentToolId,
        auth.agentInstallationId,
        session.id,
        hookRows[0].id,
        createBody.hookEvent.riskLevel,
        route.id,
        createBody.approval.requestedByAgent,
        createBody.approval.actionSummary,
        JSON.stringify(createBody.hookEvent.redactedPayload),
        expiresAt
      ]
    );

    await client.query(
      `
        insert into audit_events (
          organization_id, project_id, actor_type, event_type, entity_type, entity_id, metadata_json
        )
        values ($1, $2, 'relay', 'approval.requested', 'approval_request', $3, $4::jsonb)
      `,
      [
        auth.organizationId,
        auth.projectId,
        requestRows[0].id,
        JSON.stringify({
          actionSummary: createBody.approval.actionSummary,
          agentInstallationId: auth.agentInstallationId,
          agentSessionId: session.id,
          hookEventId: hookRows[0].id,
          relayCredentialId: auth.credentialId,
          requestedByAgent: createBody.approval.requestedByAgent,
          routeId: route.id,
          source: "relay"
        })
      ]
    );

    await client.query(
      "update installation_credentials set last_used_at = now(), last_nonce_seen_at = now() where organization_id = $1 and id = $2",
      [auth.organizationId, auth.credentialId]
    );
    await client.query(
      "update agent_installations set last_seen_at = now() where organization_id = $1 and id = $2",
      [auth.organizationId, auth.agentInstallationId]
    );
    await client.query("commit");

    return {
      agentInstallationId: auth.agentInstallationId,
      agentSessionId: session.id,
      approvalRequestId: requestRows[0].id,
      expiresAt: requestRows[0].expires_at ? toIsoString(requestRows[0].expires_at) : null,
      hookEventId: requestRows[0].hook_event_id,
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      status: "pending"
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export async function getRelayApprovalDecision(
  input: SignedRelayInput & { approvalRequestId: string }
): Promise<RelayApprovalDecisionResult> {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new RelayApprovalApiError(500, "database_not_configured", "DATABASE_URL is required.");
  }

  const databaseRole = input.databaseRole ?? process.env.HOOKWIRE_DATABASE_ROLE ?? null;
  const now = relayNow(input.now);
  const authHeaders = parseAuthHeaders(input);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("begin");
    const auth = await verifyRelayAuthentication(client, input, authHeaders, now);
    await setTenantContext(client, auth.organizationId, databaseRole);
    await insertRelayNonce(client, auth, authHeaders.nonce, now);
    const request = await lockApprovalRequestForRelay(client, auth, input.approvalRequestId);

    if (request.status === "pending" && request.is_expired) {
      await client.query(
        "update approval_requests set status = 'expired', updated_at = now() where organization_id = $1 and id = $2",
        [auth.organizationId, input.approvalRequestId]
      );
      await client.query("commit");

      return emptyDecision(input.approvalRequestId, "expired");
    }

    if (request.status === "approved" || request.status === "denied") {
      const decision = await latestDecision(client, auth.organizationId, input.approvalRequestId);
      await client.query("commit");

      return {
        approvalRequestId: input.approvalRequestId,
        decidedAt: decision ? toIsoString(decision.created_at) : null,
        decision: decision?.decision ?? request.status,
        decisionId: decision?.id ?? null,
        reason: decision?.reason ?? null,
        scope: decision?.scope ?? null,
        status: request.status,
        userId: decision?.user_id ?? null
      };
    }

    await client.query("commit");
    return emptyDecision(input.approvalRequestId, request.status);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

function parseCreateBody(rawBody: string): CreateApprovalBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new RelayApprovalApiError(400, "invalid_json", "Relay approval body must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RelayApprovalApiError(400, "invalid_request_body", "Relay approval body must be an object.");
  }

  const body = parsed as Record<string, unknown>;
  const hookEvent = readObject(body.hookEvent);
  const approval = readObject(body.approval);
  const redactedPayload = readObject(hookEvent.redactedPayload);
  validateRedactedPayload(redactedPayload);

  const riskLevel = readRequiredString(hookEvent.riskLevel, "riskLevel");
  if (!allowedRiskLevels.has(riskLevel)) {
    throw new RelayApprovalApiError(400, "invalid_risk_level", "Hook event risk level is not allowed.");
  }

  return {
    approval: {
      actionSummary: readRequiredString(approval.actionSummary, "actionSummary"),
      expiresAt: typeof approval.expiresAt === "string" ? approval.expiresAt : null,
      requestedByAgent: readRequiredString(approval.requestedByAgent, "requestedByAgent")
    },
    agentInstallationId: readRequiredString(body.agentInstallationId, "agentInstallationId"),
    agentSessionId: readRequiredString(body.agentSessionId, "agentSessionId"),
    hookEvent: {
      eventType: readRequiredString(hookEvent.eventType, "eventType"),
      operation: typeof hookEvent.operation === "string" ? hookEvent.operation : null,
      redactedPayload,
      riskLevel,
      toolName: readRequiredString(hookEvent.toolName, "toolName")
    },
    projectId: readRequiredString(body.projectId, "projectId"),
    routeId: readRequiredString(body.routeId, "routeId")
  };
}

function parseAuthHeaders(input: SignedRelayInput) {
  const keyId = requiredAuthHeader(input.headers, "x-hookwire-key-id");
  const timestamp = requiredAuthHeader(input.headers, "x-hookwire-timestamp");
  const nonce = requiredAuthHeader(input.headers, "x-hookwire-nonce");
  const bodyHash = requiredAuthHeader(input.headers, "x-hookwire-body-sha256");
  const signature = requiredAuthHeader(input.headers, "x-hookwire-signature");

  const actualBodyHash = sha256Hex(input.rawBody);
  if (!safeEqualHex(bodyHash, actualBodyHash)) {
    throw new RelayApprovalApiError(401, "invalid_relay_body_hash", "Relay body hash is invalid.");
  }

  return { bodyHash, keyId, nonce, signature, timestamp };
}

function requiredAuthHeader(headers: SignedRelayInput["headers"], name: string) {
  const value = getHeader(headers, name);
  if (!value) {
    throw new RelayApprovalApiError(401, "missing_relay_signature", "Relay signature headers are required.");
  }

  return value;
}

async function verifyRelayAuthentication(
  client: PgClient,
  input: SignedRelayInput,
  authHeaders: ReturnType<typeof parseAuthHeaders>,
  now: Date
): Promise<RelayAuthContext> {
  const signedAt = new Date(authHeaders.timestamp);
  if (!Number.isFinite(signedAt.getTime())) {
    throw new RelayApprovalApiError(401, "invalid_relay_timestamp", "Relay timestamp is invalid.");
  }

  if (Math.abs(now.getTime() - signedAt.getTime()) > relayClockSkewMs) {
    throw new RelayApprovalApiError(401, "stale_relay_timestamp", "Relay timestamp is outside the allowed clock skew.");
  }

  const { rows } = await client.query<RelayCredential>(
    `
      select
        ic.organization_id,
        ic.project_id,
        ic.agent_installation_id,
        ic.public_key,
        ic.status,
        ic.expires_at,
        ai.agent_tool_id,
        ai.status as installation_status
      from installation_credentials ic
      join agent_installations ai
        on ai.organization_id = ic.organization_id
       and ai.id = ic.agent_installation_id
      where ic.id = $1
    `,
    [authHeaders.keyId]
  );
  const credential = rows[0];
  if (!credential) {
    throw new RelayApprovalApiError(401, "relay_credential_not_found", "Relay credential was not found.");
  }

  if (credential.status !== "active" || isExpired(credential.expires_at, now)) {
    throw new RelayApprovalApiError(401, "relay_credential_not_active", "Relay credential is not active.");
  }

  if (credential.installation_status !== "active") {
    throw new RelayApprovalApiError(401, "relay_installation_not_active", "Relay installation is not active.");
  }

  const canonical = canonicalRelayMessage({
    bodyHash: authHeaders.bodyHash,
    keyId: authHeaders.keyId,
    method: input.method,
    nonce: authHeaders.nonce,
    path: input.path,
    timestamp: authHeaders.timestamp
  });

  if (!verifySignature(credential.public_key, canonical, authHeaders.signature)) {
    throw new RelayApprovalApiError(401, "invalid_relay_signature", "Relay signature is invalid.");
  }

  return {
    agentInstallationId: credential.agent_installation_id,
    agentToolId: credential.agent_tool_id,
    credentialId: authHeaders.keyId,
    organizationId: credential.organization_id,
    projectId: credential.project_id
  };
}

function assertCredentialBindings(auth: RelayAuthContext, body: CreateApprovalBody) {
  if (body.projectId !== auth.projectId) {
    throw new RelayApprovalApiError(403, "credential_project_mismatch", "Relay credential is not bound to this project.");
  }

  if (body.agentInstallationId !== auth.agentInstallationId) {
    throw new RelayApprovalApiError(
      403,
      "credential_installation_mismatch",
      "Relay credential is not bound to this installation."
    );
  }
}

async function setTenantContext(client: PgClient, organizationId: string, databaseRole: string | null) {
  if (databaseRole) {
    await client.query(`set local role ${quoteIdentifier(databaseRole)}`);
  }
  await client.query("select set_config('app.current_organization_id', $1, true)", [organizationId]);
}

async function insertRelayNonce(client: PgClient, auth: RelayAuthContext, nonce: string, now: Date) {
  try {
    await client.query(
      `
        insert into relay_request_nonces (
          organization_id, project_id, installation_credential_id, nonce_hash, expires_at
        )
        values ($1, $2, $3, $4, $5)
      `,
      [
        auth.organizationId,
        auth.projectId,
        auth.credentialId,
        sha256Hex(nonce),
        new Date(now.getTime() + relayNonceTtlSeconds * 1000)
      ]
    );
  } catch (error) {
    if (isPgError(error, "23505")) {
      throw new RelayApprovalApiError(409, "replayed_relay_nonce", "Relay nonce has already been used.");
    }
    throw error;
  }
}

async function requireSession(client: PgClient, auth: RelayAuthContext, agentSessionId: string): Promise<SessionRow> {
  const { rows } = await client.query<SessionRow>(
    `
      select id, agent_tool_id, agent_installation_id, status
      from agent_sessions
      where organization_id = $1 and project_id = $2 and id = $3
    `,
    [auth.organizationId, auth.projectId, agentSessionId]
  );
  const session = rows[0];
  if (!session) {
    throw new RelayApprovalApiError(404, "agent_session_not_found", "Agent session was not found.");
  }

  if (session.agent_installation_id !== auth.agentInstallationId || session.agent_tool_id !== auth.agentToolId) {
    throw new RelayApprovalApiError(403, "agent_session_binding_mismatch", "Agent session is not bound to this relay.");
  }

  if (session.status !== "active" && session.status !== "idle") {
    throw new RelayApprovalApiError(409, "agent_session_not_active", "Agent session is not active.");
  }

  return session;
}

async function requireRoute(client: PgClient, organizationId: string, routeId: string): Promise<RouteRow> {
  const { rows } = await client.query<RouteRow>(
    "select id, timeout_seconds from routes where organization_id = $1 and id = $2 and enabled = true",
    [organizationId, routeId]
  );
  const route = rows[0];
  if (!route) {
    throw new RelayApprovalApiError(404, "route_not_found", "Approval route was not found.");
  }

  return route;
}

async function lockApprovalRequestForRelay(
  client: PgClient,
  auth: RelayAuthContext,
  approvalRequestId: string
): Promise<ApprovalRequestRow> {
  const { rows } = await client.query<ApprovalRequestRow>(
    `
      select
        id,
        status,
        expires_at,
        expires_at is not null and expires_at <= now() as is_expired
      from approval_requests
      where organization_id = $1
        and project_id = $2
        and agent_installation_id = $3
        and id = $4
      for update
    `,
    [auth.organizationId, auth.projectId, auth.agentInstallationId, approvalRequestId]
  );
  const request = rows[0];
  if (!request) {
    throw new RelayApprovalApiError(404, "approval_request_not_found", "Approval request was not found.");
  }

  return request;
}

async function latestDecision(client: PgClient, organizationId: string, approvalRequestId: string) {
  const { rows } = await client.query<DecisionRow>(
    `
      select id, user_id, decision, scope, reason, created_at
      from approval_decisions
      where organization_id = $1 and approval_request_id = $2
      order by created_at desc
      limit 1
    `,
    [organizationId, approvalRequestId]
  );

  return rows[0] ?? null;
}

function emptyDecision(
  approvalRequestId: string,
  status: RelayApprovalDecisionResult["status"]
): RelayApprovalDecisionResult {
  return {
    approvalRequestId,
    decidedAt: null,
    decision: null,
    decisionId: null,
    reason: null,
    scope: null,
    status,
    userId: null
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

function verifySignature(publicKeyPem: string, canonical: string, signature: string) {
  try {
    return verify(null, Buffer.from(canonical), createPublicKey(publicKeyPem), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

function validateRedactedPayload(payload: Record<string, unknown>) {
  if (payload.redacted !== true) {
    throw new RelayApprovalApiError(400, "invalid_redacted_payload", "Relay payload must be marked as redacted.");
  }

  if (hasUnredactedSensitiveValue(payload)) {
    throw new RelayApprovalApiError(400, "invalid_redacted_payload", "Relay payload contains sensitive unredacted values.");
  }
}

function hasUnredactedSensitiveValue(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const keyLooksSensitive =
      normalizedKey.includes("token") ||
      normalizedKey.includes("secret") ||
      normalizedKey.includes("password") ||
      normalizedKey.includes("apikey") ||
      normalizedKey.includes("privatekey");
    if (keyLooksSensitive && typeof child === "string" && child !== "[REDACTED]" && child.trim() !== "") {
      return true;
    }

    if (hasUnredactedSensitiveValue(child)) {
      return true;
    }
  }

  return false;
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RelayApprovalApiError(400, "invalid_request_body", "Relay approval body has an invalid object field.");
  }

  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RelayApprovalApiError(400, "invalid_request_body", `${field} is required.`);
  }

  return value.trim();
}

function resolveExpiresAt(expiresAt: string | null, timeoutSeconds: number, now: Date) {
  if (!expiresAt) {
    return new Date(now.getTime() + timeoutSeconds * 1000);
  }

  const parsed = new Date(expiresAt);
  if (!Number.isFinite(parsed.getTime())) {
    throw new RelayApprovalApiError(400, "invalid_expires_at", "Approval expiration must be a valid timestamp.");
  }

  if (parsed.getTime() <= now.getTime()) {
    throw new RelayApprovalApiError(400, "invalid_expires_at", "Approval expiration must be in the future.");
  }

  return parsed;
}

function relayNow(inputNow?: Date) {
  if (inputNow) {
    return inputNow;
  }

  if (process.env.HOOKWIRE_RELAY_TEST_NOW) {
    return new Date(process.env.HOOKWIRE_RELAY_TEST_NOW);
  }

  return new Date();
}

function getHeader(headers: SignedRelayInput["headers"], name: string) {
  if (headers instanceof Headers) {
    return headers.get(name);
  }

  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isExpired(value: Date | string | null, now: Date) {
  return value ? new Date(value).getTime() <= now.getTime() : false;
}

function isPgError(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new RelayApprovalApiError(500, "invalid_database_role", "Configured database role is invalid.");
  }

  return `"${identifier.replaceAll('"', '""')}"`;
}

function toIsoString(value: Date | string) {
  return new Date(value).toISOString();
}
