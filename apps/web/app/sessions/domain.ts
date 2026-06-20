import { redactPayload, type RedactedPayload, type RiskLevel } from "../approvals/domain";

export type AgentType = "claude" | "codex" | "openclaw";
export type SessionStatus = "active" | "idle" | "ended" | "errored";
export type SessionDateFilter = "all" | "today" | "last7d";

export type SessionExplorerFilters = {
  agentType?: AgentType | "all";
  date?: SessionDateFilter;
  projectId?: string | "all";
  risk?: RiskLevel | "unknown" | "all";
  status?: SessionStatus | "all";
};

export type SessionProjectOption = {
  id: string;
  name: string;
};

export type SessionSummary = {
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  agentType: AgentType;
  agentLabel: string;
  externalSessionId: string;
  ownerName: string;
  branch: string | null;
  status: SessionStatus;
  highestRisk: RiskLevel | "unknown";
  startedAt: string;
  lastSeenAt: string | null;
  hookEventCount: number;
  approvalRequestCount: number;
  pendingApprovalCount: number;
  decisionCount: number;
};

export type SessionHookEvent = {
  id: string;
  eventType: string;
  toolName: string | null;
  operation: string | null;
  riskLevel: RiskLevel | "unknown";
  payload: RedactedPayload;
  createdAt: string;
};

export type SessionApprovalRequest = {
  id: string;
  actionSummary: string;
  riskLevel: RiskLevel | "unknown";
  status: string;
  createdAt: string;
};

export type SessionDecision = {
  id: string;
  approvalRequestId: string;
  decision: "approved" | "denied";
  reason: string | null;
  source: string;
  scope: string;
  createdAt: string;
};

export type SessionDetail = SessionSummary & {
  hookEvents: SessionHookEvent[];
  approvalRequests: SessionApprovalRequest[];
  decisions: SessionDecision[];
};

export type SessionMetrics = {
  active: number;
  agents: Record<AgentType, number>;
  ended: number;
  errored: number;
  highRisk: number;
  idle: number;
  pendingApprovals: number;
  total: number;
};

export type SessionExplorerState = {
  detail: SessionDetail | null;
  filters: Required<SessionExplorerFilters>;
  metrics: SessionMetrics;
  projectOptions: SessionProjectOption[];
  sessions: SessionSummary[];
};

type CreateSessionExplorerOptions = {
  filters?: SessionExplorerFilters;
  now?: string;
  selectedSessionId?: string | null;
};

const fixedNow = "2026-06-18T18:00:00.000Z";
const allValue = "all";

export function createSessionExplorer(options: CreateSessionExplorerOptions = {}): SessionExplorerState {
  const filters = normalizeSessionFilters(options.filters);
  const details = seedSessionDetails();
  const sessions = details.filter((session) => matchesSessionFilters(session, filters, options.now ?? fixedNow));
  const selectedSessionId = options.selectedSessionId ?? sessions[0]?.externalSessionId ?? null;
  const detail =
    details.find((session) => session.externalSessionId === selectedSessionId || session.id === selectedSessionId) ??
    sessions[0] ??
    null;

  return {
    detail,
    filters,
    metrics: getSessionMetrics(sessions),
    projectOptions: getProjectOptions(details),
    sessions
  };
}

export function normalizeSessionFilters(filters: SessionExplorerFilters = {}): Required<SessionExplorerFilters> {
  return {
    agentType: filters.agentType ?? allValue,
    date: filters.date ?? allValue,
    projectId: filters.projectId ?? allValue,
    risk: filters.risk ?? allValue,
    status: filters.status ?? allValue
  };
}

export function matchesSessionFilters(
  session: SessionSummary,
  filters: Required<SessionExplorerFilters>,
  now = fixedNow
): boolean {
  if (filters.projectId !== allValue && session.projectId !== filters.projectId) {
    return false;
  }

  if (filters.agentType !== allValue && session.agentType !== filters.agentType) {
    return false;
  }

  if (filters.status !== allValue && session.status !== filters.status) {
    return false;
  }

  if (filters.risk !== allValue && session.highestRisk !== filters.risk) {
    return false;
  }

  const dateRange = getDateRange(filters.date, now);
  if (dateRange && (Date.parse(session.startedAt) < dateRange.start || Date.parse(session.startedAt) >= dateRange.end)) {
    return false;
  }

  return true;
}

export function getSessionMetrics(sessions: SessionSummary[]): SessionMetrics {
  return sessions.reduce<SessionMetrics>(
    (metrics, session) => {
      metrics.total += 1;
      metrics.agents[session.agentType] += 1;
      metrics.pendingApprovals += session.pendingApprovalCount;

      if (session.status === "active") {
        metrics.active += 1;
      } else if (session.status === "idle") {
        metrics.idle += 1;
      } else if (session.status === "ended") {
        metrics.ended += 1;
      } else if (session.status === "errored") {
        metrics.errored += 1;
      }

      if (session.highestRisk === "high" || session.highestRisk === "critical") {
        metrics.highRisk += 1;
      }

      return metrics;
    },
    {
      active: 0,
      agents: { claude: 0, codex: 0, openclaw: 0 },
      ended: 0,
      errored: 0,
      highRisk: 0,
      idle: 0,
      pendingApprovals: 0,
      total: 0
    }
  );
}

export function getSessionExplorerQuerySnapshot(explorer: SessionExplorerState, sessionId: string) {
  const session = explorer.detail?.externalSessionId === sessionId ? explorer.detail : null;

  return {
    agent_sessions: session
      ? [
          {
            id: session.id,
            organization_id: session.organizationId,
            project_id: session.projectId,
            agent_type: session.agentType,
            external_session_id: session.externalSessionId,
            status: session.status,
            started_at: session.startedAt,
            last_seen_at: session.lastSeenAt
          }
        ]
      : [],
    approval_decisions:
      session?.decisions.map((decision) => ({
        id: decision.id,
        approval_request_id: decision.approvalRequestId,
        decision: decision.decision,
        reason: decision.reason,
        scope: decision.scope,
        source: decision.source,
        created_at: decision.createdAt
      })) ?? [],
    approval_requests:
      session?.approvalRequests.map((approval) => ({
        id: approval.id,
        action_summary: approval.actionSummary,
        risk_level: approval.riskLevel,
        status: approval.status,
        created_at: approval.createdAt
      })) ?? [],
    hook_events:
      session?.hookEvents.map((event) => ({
        id: event.id,
        event_type: event.eventType,
        operation: event.operation,
        payload_redacted: event.payload,
        risk_level: event.riskLevel,
        tool_name: event.toolName,
        created_at: event.createdAt
      })) ?? []
  };
}

export function redactSessionPayload(value: unknown): RedactedPayload {
  return redactPayload(value);
}

export function agentTypeLabel(agentType: AgentType): string {
  if (agentType === "claude") {
    return "Claude Code";
  }

  if (agentType === "openclaw") {
    return "OpenClaw";
  }

  return "Codex";
}

export function riskRank(risk: RiskLevel | "unknown"): number {
  if (risk === "critical") {
    return 5;
  }

  if (risk === "high") {
    return 4;
  }

  if (risk === "medium") {
    return 3;
  }

  if (risk === "low") {
    return 2;
  }

  return 1;
}

export function highestRisk(risks: Array<RiskLevel | "unknown">): RiskLevel | "unknown" {
  return risks.reduce<RiskLevel | "unknown">(
    (highest, candidate) => (riskRank(candidate) > riskRank(highest) ? candidate : highest),
    "unknown"
  );
}

function getProjectOptions(sessions: SessionSummary[]): SessionProjectOption[] {
  const projects = new Map<string, SessionProjectOption>();

  for (const session of sessions) {
    projects.set(session.projectId, { id: session.projectId, name: session.projectName });
  }

  return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function getDateRange(date: SessionDateFilter, now: string): { end: number; start: number } | null {
  if (date === "all") {
    return null;
  }

  const nowDate = new Date(now);
  if (date === "today") {
    const start = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());

    return { end: start + 86_400_000, start };
  }

  return { end: nowDate.getTime() + 1, start: nowDate.getTime() - 7 * 86_400_000 };
}

function seedSessionDetails(): SessionDetail[] {
  const codexEvents: SessionHookEvent[] = [
    {
      id: "evt-codex-shell",
      createdAt: "2026-06-18T17:18:00.000Z",
      eventType: "tool.invoked",
      operation: "npm run db:migrate",
      payload: redactSessionPayload({
        command: "npm run db:migrate && npm run web:build",
        env: {
          DATABASE_URL: "postgres://hookwire:local-dev-password@localhost:5432/hookwire",
          HOOKWIRE_TOKEN: "sk-live-super-secret"
        }
      }),
      riskLevel: "high",
      toolName: "shell"
    },
    {
      id: "evt-codex-approval",
      createdAt: "2026-06-18T17:19:00.000Z",
      eventType: "approval.requested",
      operation: "approval request created",
      payload: redactSessionPayload({ approvalId: "APR-1042", token: "sk-live-super-secret" }),
      riskLevel: "high",
      toolName: "approval"
    }
  ];
  const codexApprovals: SessionApprovalRequest[] = [
    {
      id: "APR-1042",
      actionSummary: "Apply migration and write project settings",
      createdAt: "2026-06-18T17:19:30.000Z",
      riskLevel: "high",
      status: "approved"
    }
  ];
  const codexDecisions: SessionDecision[] = [
    {
      id: "DEC-APR-1042-1",
      approvalRequestId: "APR-1042",
      createdAt: "2026-06-18T17:20:00.000Z",
      decision: "approved",
      reason: "Reviewed migration",
      scope: "once",
      source: "web"
    }
  ];
  const claudeEvents: SessionHookEvent[] = [
    {
      id: "evt-claude-write",
      createdAt: "2026-06-18T16:55:00.000Z",
      eventType: "tool.invoked",
      operation: "Patch relay config",
      payload: redactSessionPayload({ path: ".hookwire/relay.json", diff: ["route: slack-oncall"] }),
      riskLevel: "medium",
      toolName: "write_file"
    }
  ];
  const openclawEvents: SessionHookEvent[] = [
    {
      id: "evt-openclaw-read",
      createdAt: "2026-06-12T10:02:00.000Z",
      eventType: "tool.invoked",
      operation: "Read adapter manifest",
      payload: redactSessionPayload({ path: "adapter.json" }),
      riskLevel: "low",
      toolName: "read_file"
    }
  ];

  return [
    {
      id: "session-codex-7f31",
      agentLabel: "Codex",
      agentType: "codex",
      approvalRequestCount: codexApprovals.length,
      approvalRequests: codexApprovals,
      branch: "codex/issue-006-session-explorer",
      decisionCount: codexDecisions.length,
      decisions: codexDecisions,
      externalSessionId: "codex-7f31",
      highestRisk: highestRisk([...codexEvents.map((event) => event.riskLevel), ...codexApprovals.map((approval) => approval.riskLevel)]),
      hookEventCount: codexEvents.length,
      hookEvents: codexEvents,
      lastSeenAt: "2026-06-18T17:24:00.000Z",
      organizationId: "org-acme",
      ownerName: "Maya W.",
      pendingApprovalCount: codexApprovals.filter((approval) => approval.status === "pending").length,
      projectId: "project-hookwire-web",
      projectName: "hookwire/web",
      startedAt: "2026-06-18T17:15:00.000Z",
      status: "active"
    },
    {
      id: "session-claude-a88c",
      agentLabel: "Claude Code",
      agentType: "claude",
      approvalRequestCount: 1,
      approvalRequests: [
        {
          id: "APR-1041",
          actionSummary: "Patch local relay config",
          createdAt: "2026-06-18T16:56:00.000Z",
          riskLevel: "medium",
          status: "pending"
        }
      ],
      branch: "main",
      decisionCount: 0,
      decisions: [],
      externalSessionId: "claude-a88c",
      highestRisk: "medium",
      hookEventCount: claudeEvents.length,
      hookEvents: claudeEvents,
      lastSeenAt: "2026-06-18T16:59:00.000Z",
      organizationId: "org-acme",
      ownerName: "Maya W.",
      pendingApprovalCount: 1,
      projectId: "project-infra-relay",
      projectName: "infra/relay",
      startedAt: "2026-06-18T16:50:00.000Z",
      status: "idle"
    },
    {
      id: "session-openclaw-19b2",
      agentLabel: "OpenClaw",
      agentType: "openclaw",
      approvalRequestCount: 0,
      approvalRequests: [],
      branch: "adapter-probe",
      decisionCount: 0,
      decisions: [],
      externalSessionId: "openclaw-19b2",
      highestRisk: "low",
      hookEventCount: openclawEvents.length,
      hookEvents: openclawEvents,
      lastSeenAt: "2026-06-12T10:09:00.000Z",
      organizationId: "org-acme",
      ownerName: "Sam R.",
      pendingApprovalCount: 0,
      projectId: "project-hookwire-web",
      projectName: "hookwire/web",
      startedAt: "2026-06-12T10:00:00.000Z",
      status: "ended"
    }
  ];
}
