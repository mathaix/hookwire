export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";
export type ApprovalDecisionValue = "approved" | "denied";
export type PersonaId = "approver" | "viewer";
export type InboxScenario = "default" | "empty";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export type RedactedPayload = null | string | number | boolean | RedactedPayload[] | { [key: string]: RedactedPayload };

export type ApprovalRequest = {
  id: string;
  organizationId: string;
  projectId: string;
  project: string;
  agentToolId: string;
  agentInstallationId: string;
  agentSessionId: string;
  agent: string;
  status: ApprovalStatus;
  riskLevel: RiskLevel;
  routeId: string;
  route: string;
  policy: string;
  requestedByAgent: string;
  requester: string;
  actionSummary: string;
  redactedPayload: RedactedPayload;
  requireDenyReason: boolean;
  requestedLabel: string;
  createdAt: string;
  expiresAt: string;
};

export type Reviewer = {
  id: string;
  name: string;
  email: string;
  persona: PersonaId;
  canApprove: boolean;
};

export type ApprovalDecisionRecord = {
  id: string;
  approvalRequestId: string;
  organizationId: string;
  userId: string;
  source: "web";
  decision: ApprovalDecisionValue;
  scope: "once";
  reason: string | null;
  createdAt: string;
};

export type ApprovalAuditEvent = {
  id: string;
  organizationId: string;
  projectId: string;
  actorType: "user";
  actorUserId: string;
  eventType: "approval.approved" | "approval.denied";
  entityType: "approval_request";
  entityId: string;
  metadata: {
    decisionId: string;
    approvalRequestId: string;
    riskLevel: RiskLevel;
    routeId: string;
    reasonRequired: boolean;
  };
  createdAt: string;
};

export type ApprovalInboxState = {
  now: string;
  reviewer: Reviewer;
  selectedApprovalId: string | null;
  approvals: ApprovalRequest[];
  decisions: ApprovalDecisionRecord[];
  auditEvents: ApprovalAuditEvent[];
};

type CreateInboxOptions = {
  scenario?: InboxScenario;
  persona?: PersonaId;
};

type DecisionInput = {
  approvalId: string;
  decision: ApprovalDecisionValue;
  reason?: string;
};

export type DecisionResult =
  | { ok: true; code: "decided"; decisionId: string; auditEventId: string }
  | { ok: false; code: "not_found" | "already_decided" | "expired" | "unauthorized" | "reason_required"; message: string };

const fixedNow = "2026-06-18T17:30:00.000Z";

const reviewers: Record<PersonaId, Reviewer> = {
  approver: {
    id: "usr-maya",
    name: "Maya W.",
    email: "maya@acme.dev",
    persona: "approver",
    canApprove: true
  },
  viewer: {
    id: "usr-viewer",
    name: "Vic Viewer",
    email: "viewer@acme.dev",
    persona: "viewer",
    canApprove: false
  }
};

const sensitiveKeyPattern = /(authorization|api[_-]?key|token|secret|password|credential|private[_-]?key)/i;
const secretValueRedactors = [
  { pattern: /Bearer\s+[^"\s]+/gi, replacement: "[redacted]" },
  { pattern: /Basic\s+[^"\s]+/gi, replacement: "[redacted]" },
  { pattern: /([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s]+(@)/gi, replacement: "$1[redacted]$2" },
  { pattern: /(password|token|secret|api[_-]?key)=([^&\s"']+)/gi, replacement: "$1=[redacted]" },
  { pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: "[redacted]" },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: "[redacted]" },
  { pattern: /sk-[a-z0-9-]+/gi, replacement: "[redacted]" },
  { pattern: /gh[pousr]_[a-z0-9_]+/gi, replacement: "[redacted]" }
];

export function redactPayload(value: unknown, key = ""): RedactedPayload {
  if (sensitiveKeyPattern.test(key)) {
    return "[redacted]";
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return secretValueRedactors.reduce(
      (redacted, redactor) => redacted.replace(redactor.pattern, redactor.replacement),
      value
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactPayload(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactPayload(entryValue, entryKey)
      ])
    );
  }

  return String(value);
}

export function createApprovalInbox(options: CreateInboxOptions = {}): ApprovalInboxState {
  const scenario = options.scenario ?? "default";
  const reviewer = reviewers[options.persona ?? "approver"];
  const approvals = scenario === "empty" ? [] : seedApprovals();

  return {
    now: fixedNow,
    reviewer,
    selectedApprovalId: approvals[0]?.id ?? null,
    approvals,
    decisions: [],
    auditEvents: []
  };
}

export function getPendingApprovals(state: ApprovalInboxState): ApprovalRequest[] {
  return state.approvals.filter((approval) => approval.status === "pending" && !isExpired(approval, state.now));
}

export function getSelectedApproval(state: ApprovalInboxState, requestedId?: string | null): ApprovalRequest | null {
  const selectedId = requestedId ?? state.selectedApprovalId;

  return state.approvals.find((approval) => approval.id === selectedId) ?? state.approvals[0] ?? null;
}

export function isExpired(approval: ApprovalRequest, now: string): boolean {
  return approval.status === "expired" || Date.parse(approval.expiresAt) <= Date.parse(now);
}

export function canReviewerDecide(state: ApprovalInboxState, approval: ApprovalRequest): boolean {
  return state.reviewer.canApprove && approval.status === "pending" && !isExpired(approval, state.now);
}

export function decideApproval(state: ApprovalInboxState, input: DecisionInput): {
  state: ApprovalInboxState;
  result: DecisionResult;
} {
  const approval = state.approvals.find((candidate) => candidate.id === input.approvalId);

  if (!approval) {
    return { state, result: { ok: false, code: "not_found", message: `Approval ${input.approvalId} was not found.` } };
  }

  const existingDecision = state.decisions.find((decision) => decision.approvalRequestId === approval.id);
  if (existingDecision || approval.status === "approved" || approval.status === "denied") {
    return {
      state,
      result: { ok: false, code: "already_decided", message: `${approval.id} already has a recorded decision.` }
    };
  }

  if (isExpired(approval, state.now)) {
    return {
      state,
      result: { ok: false, code: "expired", message: `${approval.id} expired before a decision was recorded.` }
    };
  }

  if (!state.reviewer.canApprove) {
    return {
      state,
      result: { ok: false, code: "unauthorized", message: `${state.reviewer.email} cannot approve this route.` }
    };
  }

  const reason = input.reason?.trim() ?? "";
  if (input.decision === "denied" && approval.requireDenyReason && reason.length === 0) {
    return {
      state,
      result: { ok: false, code: "reason_required", message: `Reason required to deny ${approval.id}.` }
    };
  }

  const sequence = state.decisions.length + 1;
  const decisionId = `DEC-${approval.id}-${sequence}`;
  const auditEventId = `AUD-${approval.id}-${input.decision}-${sequence}`;
  const createdAt = state.now;
  const decision: ApprovalDecisionRecord = {
    id: decisionId,
    approvalRequestId: approval.id,
    organizationId: approval.organizationId,
    userId: state.reviewer.id,
    source: "web",
    decision: input.decision,
    scope: "once",
    reason: reason || null,
    createdAt
  };
  const auditEvent: ApprovalAuditEvent = {
    id: auditEventId,
    organizationId: approval.organizationId,
    projectId: approval.projectId,
    actorType: "user",
    actorUserId: state.reviewer.id,
    eventType: `approval.${input.decision}`,
    entityType: "approval_request",
    entityId: approval.id,
    metadata: {
      decisionId,
      approvalRequestId: approval.id,
      riskLevel: approval.riskLevel,
      routeId: approval.routeId,
      reasonRequired: approval.requireDenyReason
    },
    createdAt
  };

  return {
    state: {
      ...state,
      approvals: state.approvals.map((candidate) =>
        candidate.id === approval.id ? { ...candidate, status: input.decision } : candidate
      ),
      decisions: [...state.decisions, decision],
      auditEvents: [...state.auditEvents, auditEvent],
      selectedApprovalId: approval.id
    },
    result: { ok: true, code: "decided", decisionId, auditEventId }
  };
}

export function getApprovalQuerySnapshot(state: ApprovalInboxState, approvalId: string) {
  const approvalRows = state.approvals
    .filter((approval) => approval.id === approvalId)
    .map((approval) => ({
      id: approval.id,
      organization_id: approval.organizationId,
      project_id: approval.projectId,
      agent_tool_id: approval.agentToolId,
      agent_installation_id: approval.agentInstallationId,
      agent_session_id: approval.agentSessionId,
      status: approval.status,
      risk_level: approval.riskLevel,
      route_id: approval.routeId,
      requested_by_agent: approval.requestedByAgent,
      action_summary: approval.actionSummary,
      redacted_payload_json: approval.redactedPayload,
      expires_at: approval.expiresAt,
      created_at: approval.createdAt
    }));
  const decisionRows = state.decisions
    .filter((decision) => decision.approvalRequestId === approvalId)
    .map((decision) => ({
      id: decision.id,
      approval_request_id: decision.approvalRequestId,
      organization_id: decision.organizationId,
      user_id: decision.userId,
      source: decision.source,
      decision: decision.decision,
      scope: decision.scope,
      reason: decision.reason,
      created_at: decision.createdAt
    }));
  const auditRows = state.auditEvents
    .filter((event) => event.entityId === approvalId)
    .map((event) => ({
      id: event.id,
      organization_id: event.organizationId,
      project_id: event.projectId,
      actor_type: event.actorType,
      actor_user_id: event.actorUserId,
      event_type: event.eventType,
      entity_type: event.entityType,
      entity_id: event.entityId,
      metadata_json: event.metadata,
      created_at: event.createdAt
    }));

  return {
    approval_requests: approvalRows,
    approval_decisions: decisionRows,
    audit_events: auditRows
  };
}

function seedApprovals(): ApprovalRequest[] {
  return [
    {
      id: "APR-1042",
      organizationId: "org-acme",
      projectId: "project-hookwire-web",
      project: "hookwire/web",
      agentToolId: "tool-codex",
      agentInstallationId: "install-codex-maya",
      agentSessionId: "codex-7f31",
      agent: "Codex",
      status: "pending",
      riskLevel: "high",
      routeId: "route-web-inbox",
      route: "Web inbox",
      policy: "Default write guard",
      requestedByAgent: "codex-7f31",
      requester: "maya@acme.dev",
      actionSummary: "Apply migration and write project settings",
      redactedPayload: redactPayload({
        tool: "shell",
        command: "npm run db:migrate && npm run web:build",
        cwd: "/Users/maya/src/hookwire",
        env: {
          DATABASE_URL: "postgres://hookwire:local-dev-password@localhost:5432/hookwire",
          HOOKWIRE_TOKEN: "sk-live-super-secret",
          SAFE_FLAG: "true"
        }
      }),
      requireDenyReason: false,
      requestedLabel: "2m ago",
      createdAt: "2026-06-18T17:28:00.000Z",
      expiresAt: "2026-06-18T17:45:00.000Z"
    },
    {
      id: "APR-1041",
      organizationId: "org-acme",
      projectId: "project-infra-relay",
      project: "infra/relay",
      agentToolId: "tool-claude",
      agentInstallationId: "install-claude-relay",
      agentSessionId: "claude-a88c",
      agent: "Claude Code",
      status: "pending",
      riskLevel: "medium",
      routeId: "route-on-call",
      route: "On-call reviewers",
      policy: "Relay config guard",
      requestedByAgent: "claude-a88c",
      requester: "shared relay",
      actionSummary: "Patch local relay config",
      redactedPayload: redactPayload({
        tool: "write_file",
        path: ".hookwire/relay.json",
        diff: ["route: slack-oncall", "fallback: web-inbox"],
        reason: "Route approval request to current on-call reviewer"
      }),
      requireDenyReason: true,
      requestedLabel: "9m ago",
      createdAt: "2026-06-18T17:21:00.000Z",
      expiresAt: "2026-06-18T17:50:00.000Z"
    },
    {
      id: "APR-1039",
      organizationId: "org-acme",
      projectId: "project-prod-api",
      project: "prod/api",
      agentToolId: "tool-openclaw",
      agentInstallationId: "install-openclaw-prod",
      agentSessionId: "openclaw-15e9",
      agent: "OpenClaw",
      status: "expired",
      riskLevel: "critical",
      routeId: "route-web-inbox",
      route: "Web inbox",
      policy: "Production deploy lock",
      requestedByAgent: "openclaw-15e9",
      requester: "release desk",
      actionSummary: "Production deploy command expired",
      redactedPayload: redactPayload({
        tool: "shell",
        command: "deploy production --target api",
        approvalWindow: "expired"
      }),
      requireDenyReason: true,
      requestedLabel: "31m ago",
      createdAt: "2026-06-18T16:59:00.000Z",
      expiresAt: "2026-06-18T17:15:00.000Z"
    }
  ];
}
