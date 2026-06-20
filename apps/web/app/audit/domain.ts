export const auditEventTypes = [
  "approval.requested",
  "approval.approved",
  "policy.changed",
  "route.changed",
  "key.registered",
  "key.revoked",
  "session.claimed",
  "local_override.used"
] as const;

export type AuditEventType = (typeof auditEventTypes)[number];
export type AuditActorType = "user" | "relay" | "integration" | "system";
export type AuditEntityType =
  | "approval_request"
  | "approval_decision"
  | "policy"
  | "route"
  | "user_device_key"
  | "agent_session"
  | "local_override";
export type AuditMetadata = JsonObject;
type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

export type AuditActor = {
  type: AuditActorType;
  userId: string | null;
  userName: string | null;
  userEmail?: string | null;
};

export type AuditEventRecord = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  actor: AuditActor;
  eventType: AuditEventType;
  entityType: AuditEntityType;
  entityId: string | null;
  metadata: AuditMetadata;
  createdAt: string;
};

export type AuditFilters = {
  actorUserId?: string | null;
  entityId?: string | null;
  entityType?: AuditEntityType | "all" | null;
  projectId?: string | null;
};

export type AuditTimelineState = {
  events: AuditEventRecord[];
  selectedEventId: string | null;
  filters: {
    actorUserId: string;
    entityType: AuditEntityType | "all";
    projectId: string;
  };
  projects: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
};

const sensitiveKeyPattern = /authorization|bearer|cookie|credential|password|private[_-]?key|secret|session[_-]?key|token|api[_-]?key/i;

export function createAuditTimeline(): AuditTimelineState {
  const events = seedAuditEvents().map((event) => ({
    ...event,
    metadata: redactAuditMetadata(event.metadata)
  }));

  return {
    events,
    filters: {
      actorUserId: "all",
      entityType: "all",
      projectId: "all"
    },
    projects: [
      { id: "project-web", name: "hookwire/web" },
      { id: "project-relay", name: "infra/relay" }
    ],
    selectedEventId: events[0]?.id ?? null,
    users: [
      { id: "user-maya", name: "Maya" },
      { id: "user-sam", name: "Sam" }
    ]
  };
}

export function filterAuditEvents(events: AuditEventRecord[], filters: AuditFilters): AuditEventRecord[] {
  return events.filter((event) => {
    const projectMatches = !filters.projectId || filters.projectId === "all" || event.projectId === filters.projectId;
    const entityMatches =
      !filters.entityType ||
      filters.entityType === "all" ||
      (event.entityType === filters.entityType && (!filters.entityId || event.entityId === filters.entityId));
    const actorMatches =
      !filters.actorUserId || filters.actorUserId === "all" || event.actor.userId === filters.actorUserId;

    return projectMatches && entityMatches && actorMatches;
  });
}

export function getSelectedAuditEvent(events: AuditEventRecord[], selectedEventId: string | null): AuditEventRecord | null {
  return events.find((event) => event.id === selectedEventId) ?? events[0] ?? null;
}

export function redactAuditMetadata(metadata: unknown): AuditMetadata {
  const redacted = redactJsonValue(metadata);
  if (isPlainObject(redacted)) {
    return redacted;
  }

  return { value: redacted };
}

export function labelForEntityType(entityType: AuditEntityType): string {
  return entityType.replaceAll("_", " ");
}

function redactJsonValue(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item));
  }
  if (isPlainObject(value)) {
    const redacted: JsonObject = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      redacted[key] = sensitiveKeyPattern.test(key) ? "[REDACTED]" : redactJsonValue(nestedValue);
    }

    return redacted;
  }
  if (typeof value === "string") {
    return redactSecretPatterns(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  return null;
}

function redactSecretPatterns(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\b(password|api_key|apikey|token|secret)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/--(token|password|secret|api-key)\s+\S+/gi, "--$1 [REDACTED]");
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function seedAuditEvents(): AuditEventRecord[] {
  return [
    {
      actor: { type: "relay", userId: null, userName: "Codex relay" },
      createdAt: "2026-06-20T15:10:00.000Z",
      entityId: "approval-apr-1042",
      entityType: "approval_request",
      eventType: "approval.requested",
      id: "audit-approval-requested",
      metadata: {
        actionSummary: "Write route config",
        redactedPayload: { command: "apply_patch --token sk-live-super-secret" },
        risk: "high"
      },
      projectId: "project-web",
      projectName: "hookwire/web"
    },
    {
      actor: { type: "user", userId: "user-maya", userName: "Maya", userEmail: "maya@acme.dev" },
      createdAt: "2026-06-20T15:11:00.000Z",
      entityId: "decision-apr-1042",
      entityType: "approval_decision",
      eventType: "approval.approved",
      id: "audit-approval-approved",
      metadata: { reason: "Reviewed migration", scope: "once" },
      projectId: "project-web",
      projectName: "hookwire/web"
    },
    {
      actor: { type: "user", userId: "user-sam", userName: "Sam", userEmail: "sam@acme.dev" },
      createdAt: "2026-06-20T15:12:00.000Z",
      entityId: "policy-deploy-guard",
      entityType: "policy",
      eventType: "policy.changed",
      id: "audit-policy-changed",
      metadata: { change: "enabled route rule", version: 4 },
      projectId: "project-web",
      projectName: "hookwire/web"
    },
    {
      actor: { type: "user", userId: "user-sam", userName: "Sam", userEmail: "sam@acme.dev" },
      createdAt: "2026-06-20T15:13:00.000Z",
      entityId: "route-web-inbox",
      entityType: "route",
      eventType: "route.changed",
      id: "audit-route-changed",
      metadata: { fallbackRoute: "Fallback terminal", targetType: "web_inbox" },
      projectId: "project-web",
      projectName: "hookwire/web"
    },
    {
      actor: { type: "user", userId: "user-maya", userName: "Maya", userEmail: "maya@acme.dev" },
      createdAt: "2026-06-20T15:14:00.000Z",
      entityId: "key-maya-laptop",
      entityType: "user_device_key",
      eventType: "key.registered",
      id: "audit-key-registered",
      metadata: { fingerprint: "SHA256:audit-key", privateKey: "private-key-material" },
      projectId: "project-web",
      projectName: "hookwire/web"
    },
    {
      actor: { type: "user", userId: "user-maya", userName: "Maya", userEmail: "maya@acme.dev" },
      createdAt: "2026-06-20T15:15:00.000Z",
      entityId: "key-old-laptop",
      entityType: "user_device_key",
      eventType: "key.revoked",
      id: "audit-key-revoked",
      metadata: { fingerprint: "SHA256:old-key", revocationReason: "Device retired" },
      projectId: "project-web",
      projectName: "hookwire/web"
    },
    {
      actor: { type: "user", userId: "user-maya", userName: "Maya", userEmail: "maya@acme.dev" },
      createdAt: "2026-06-20T15:16:00.000Z",
      entityId: "session-codex-7f31",
      entityType: "agent_session",
      eventType: "session.claimed",
      id: "audit-session-claimed",
      metadata: { confidence: 1, source: "manual_claim" },
      projectId: "project-web",
      projectName: "hookwire/web"
    },
    {
      actor: { type: "user", userId: "user-maya", userName: "Maya", userEmail: "maya@acme.dev" },
      createdAt: "2026-06-20T15:17:00.000Z",
      entityId: null,
      entityType: "local_override",
      eventType: "local_override.used",
      id: "audit-local-override",
      metadata: {
        authorization: "Bearer raw-super-token",
        command: "deploy --token sk-live-super-secret",
        githubToken: "ghp_rawgithubtoken",
        reason: "Emergency unblock"
      },
      projectId: "project-web",
      projectName: "hookwire/web"
    }
  ];
}
