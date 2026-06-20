import pg from "pg";
import {
  agentTypeLabel,
  getSessionMetrics,
  redactSessionPayload,
  type AgentType,
  type SessionApprovalRequest,
  type SessionDateFilter,
  type SessionDecision,
  type SessionDetail,
  type SessionExplorerFilters,
  type SessionHookEvent,
  type SessionStatus,
  type SessionSummary
} from "./domain";

const { Client } = pg;

export type ListSessionsInput = {
  databaseRole?: string | null;
  databaseUrl?: string;
  filters: SessionExplorerFilters;
  limit?: number;
  now?: string;
  organizationId: string;
};

export type GetSessionDetailInput = {
  databaseRole?: string | null;
  databaseUrl?: string;
  organizationId: string;
  sessionId: string;
};

type SessionRow = {
  approval_request_count: string;
  branch: string | null;
  decision_count: string;
  external_session_id: string | null;
  highest_risk: string;
  hook_event_count: string;
  id: string;
  last_seen_at: Date | string | null;
  organization_id: string;
  owner_name: string | null;
  pending_approval_count: string;
  project_id: string;
  project_name: string;
  started_at: Date | string;
  status: SessionStatus;
  agent_type: AgentType;
};

type HookEventRow = {
  created_at: Date | string;
  event_type: string;
  id: string;
  operation: string | null;
  payload_redacted: unknown;
  risk_level: string;
  tool_name: string | null;
};

type ApprovalRequestRow = {
  action_summary: string;
  created_at: Date | string;
  id: string;
  risk_level: string;
  status: string;
};

type DecisionRow = {
  approval_request_id: string;
  created_at: Date | string;
  decision: "approved" | "denied";
  id: string;
  reason: string | null;
  scope: string;
  source: string;
};

const allValue = "all";
const validDateFilters = new Set<SessionDateFilter>(["all", "today", "last7d"]);

export async function listSessions(input: ListSessionsInput) {
  const summaries = await withTenantClient(input, async (client) => {
    const filters = normalizeDbFilters(input.filters);
    const range = getDateRange(filters.date, input.now ?? new Date().toISOString());
    const { rows } = await client.query<SessionRow>(
      `
        with session_rollups as (
          select
            s.id,
            s.organization_id,
            s.project_id,
            p.name as project_name,
            s.agent_type,
            s.external_session_id,
            s.branch,
            s.status,
            s.started_at,
            s.last_seen_at,
            coalesce(claimed.name, started.name, 'Unclaimed') as owner_name,
            count(distinct he.id) as hook_event_count,
            count(distinct ar.id) as approval_request_count,
            count(distinct ar.id) filter (where ar.status = 'pending') as pending_approval_count,
            count(distinct ad.id) as decision_count,
            greatest(
              coalesce(max(
                case he.risk_level
                  when 'critical' then 5
                  when 'high' then 4
                  when 'medium' then 3
                  when 'low' then 2
                  else 1
                end
              ), 1),
              coalesce(max(
                case ar.risk_level
                  when 'critical' then 5
                  when 'high' then 4
                  when 'medium' then 3
                  when 'low' then 2
                  else 1
                end
              ), 1)
            ) as highest_risk_rank
          from agent_sessions s
          join projects p on p.organization_id = s.organization_id and p.id = s.project_id
          left join users started on started.id = s.started_by_user_id
          left join users claimed on claimed.id = s.claimed_by_user_id
          left join hook_events he on he.organization_id = s.organization_id and he.agent_session_id = s.id
          left join approval_requests ar on ar.organization_id = s.organization_id and ar.agent_session_id = s.id
          left join approval_decisions ad on ad.organization_id = s.organization_id and ad.approval_request_id = ar.id
          where s.organization_id = $1
            and ($2::uuid is null or s.project_id = $2::uuid)
            and ($3::text is null or s.agent_type = $3::text)
            and ($4::text is null or s.status = $4::text)
            and ($5::timestamptz is null or s.started_at >= $5::timestamptz)
            and ($6::timestamptz is null or s.started_at < $6::timestamptz)
          group by
            s.id,
            s.organization_id,
            s.project_id,
            p.name,
            s.agent_type,
            s.external_session_id,
            s.branch,
            s.status,
            s.started_at,
            s.last_seen_at,
            claimed.name,
            started.name
        )
        select
          id,
          organization_id,
          project_id,
          project_name,
          agent_type,
          external_session_id,
          branch,
          status,
          started_at,
          last_seen_at,
          owner_name,
          hook_event_count,
          approval_request_count,
          pending_approval_count,
          decision_count,
          case highest_risk_rank
            when 5 then 'critical'
            when 4 then 'high'
            when 3 then 'medium'
            when 2 then 'low'
            else 'unknown'
          end as highest_risk
        from session_rollups
        where ($7::text is null or (
          case highest_risk_rank
            when 5 then 'critical'
            when 4 then 'high'
            when 3 then 'medium'
            when 2 then 'low'
            else 'unknown'
          end
        ) = $7::text)
        order by last_seen_at desc nulls last, started_at desc, id
        limit $8
      `,
      [
        input.organizationId,
        filters.projectId === allValue ? null : filters.projectId,
        filters.agentType === allValue ? null : filters.agentType,
        filters.status === allValue ? null : filters.status,
        range?.start ?? null,
        range?.end ?? null,
        filters.risk === allValue ? null : filters.risk,
        input.limit ?? 50
      ]
    );

    return rows.map(mapSessionRow);
  });

  return {
    metrics: getSessionMetrics(summaries),
    sessions: summaries
  };
}

export async function getSessionDetail(input: GetSessionDetailInput): Promise<SessionDetail | null> {
  return withTenantClient(input, async (client) => {
    const { rows } = await client.query<SessionRow>(
      `
        with session_rollup as (
          select
            s.id,
            s.organization_id,
            s.project_id,
            p.name as project_name,
            s.agent_type,
            s.external_session_id,
            s.branch,
            s.status,
            s.started_at,
            s.last_seen_at,
            coalesce(claimed.name, started.name, 'Unclaimed') as owner_name,
            count(distinct he.id) as hook_event_count,
            count(distinct ar.id) as approval_request_count,
            count(distinct ar.id) filter (where ar.status = 'pending') as pending_approval_count,
            count(distinct ad.id) as decision_count,
            greatest(
              coalesce(max(
                case he.risk_level
                  when 'critical' then 5
                  when 'high' then 4
                  when 'medium' then 3
                  when 'low' then 2
                  else 1
                end
              ), 1),
              coalesce(max(
                case ar.risk_level
                  when 'critical' then 5
                  when 'high' then 4
                  when 'medium' then 3
                  when 'low' then 2
                  else 1
                end
              ), 1)
            ) as highest_risk_rank
          from agent_sessions s
          join projects p on p.organization_id = s.organization_id and p.id = s.project_id
          left join users started on started.id = s.started_by_user_id
          left join users claimed on claimed.id = s.claimed_by_user_id
          left join hook_events he on he.organization_id = s.organization_id and he.agent_session_id = s.id
          left join approval_requests ar on ar.organization_id = s.organization_id and ar.agent_session_id = s.id
          left join approval_decisions ad on ad.organization_id = s.organization_id and ad.approval_request_id = ar.id
          where s.organization_id = $1 and s.id = $2
          group by
            s.id,
            s.organization_id,
            s.project_id,
            p.name,
            s.agent_type,
            s.external_session_id,
            s.branch,
            s.status,
            s.started_at,
            s.last_seen_at,
            claimed.name,
            started.name
        )
        select
          id,
          organization_id,
          project_id,
          project_name,
          agent_type,
          external_session_id,
          branch,
          status,
          started_at,
          last_seen_at,
          owner_name,
          hook_event_count,
          approval_request_count,
          pending_approval_count,
          decision_count,
          case highest_risk_rank
            when 5 then 'critical'
            when 4 then 'high'
            when 3 then 'medium'
            when 2 then 'low'
            else 'unknown'
          end as highest_risk
        from session_rollup
      `,
      [input.organizationId, input.sessionId]
    );
    const summary = rows[0] ? mapSessionRow(rows[0]) : null;
    if (!summary) {
      return null;
    }

    const hookEvents = await queryHookEvents(client, input.organizationId, summary.id);
    const approvalRequests = await queryApprovalRequests(client, input.organizationId, summary.id);
    const decisions = await queryDecisions(client, input.organizationId, summary.id);

    return {
      ...summary,
      approvalRequests,
      decisions,
      hookEvents
    };
  });
}

async function withTenantClient<T>(
  input: { databaseRole?: string | null; databaseUrl?: string; organizationId: string },
  callback: (client: InstanceType<typeof Client>) => Promise<T>
) {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const databaseRole = input.databaseRole ?? process.env.HOOKWIRE_DATABASE_ROLE ?? null;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("begin");
    if (databaseRole) {
      await client.query(`set local role ${quoteIdentifier(databaseRole)}`);
    }
    await client.query("select set_config('app.current_organization_id', $1, true)", [input.organizationId]);
    const result = await callback(client);
    await client.query("commit");

    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function queryHookEvents(
  client: InstanceType<typeof Client>,
  organizationId: string,
  sessionId: string
): Promise<SessionHookEvent[]> {
  const { rows } = await client.query<HookEventRow>(
    `
      select id, event_type, tool_name, operation, risk_level, payload_redacted, created_at
      from hook_events
      where organization_id = $1 and agent_session_id = $2
      order by created_at, id
    `,
    [organizationId, sessionId]
  );

  return rows.map((row) => ({
    id: row.id,
    createdAt: toIso(row.created_at),
    eventType: row.event_type,
    operation: row.operation,
    payload: redactSessionPayload(row.payload_redacted),
    riskLevel: normalizeRisk(row.risk_level),
    toolName: row.tool_name
  }));
}

async function queryApprovalRequests(
  client: InstanceType<typeof Client>,
  organizationId: string,
  sessionId: string
): Promise<SessionApprovalRequest[]> {
  const { rows } = await client.query<ApprovalRequestRow>(
    `
      select id, status, risk_level, action_summary, created_at
      from approval_requests
      where organization_id = $1 and agent_session_id = $2
      order by created_at, id
    `,
    [organizationId, sessionId]
  );

  return rows.map((row) => ({
    id: row.id,
    actionSummary: row.action_summary,
    createdAt: toIso(row.created_at),
    riskLevel: normalizeRisk(row.risk_level),
    status: row.status
  }));
}

async function queryDecisions(
  client: InstanceType<typeof Client>,
  organizationId: string,
  sessionId: string
): Promise<SessionDecision[]> {
  const { rows } = await client.query<DecisionRow>(
    `
      select ad.id, ad.approval_request_id, ad.decision, ad.reason, ad.source, ad.scope, ad.created_at
      from approval_decisions ad
      join approval_requests ar on ar.organization_id = ad.organization_id and ar.id = ad.approval_request_id
      where ad.organization_id = $1 and ar.agent_session_id = $2
      order by ad.created_at, ad.id
    `,
    [organizationId, sessionId]
  );

  return rows.map((row) => ({
    id: row.id,
    approvalRequestId: row.approval_request_id,
    createdAt: toIso(row.created_at),
    decision: row.decision,
    reason: row.reason,
    scope: row.scope,
    source: row.source
  }));
}

function normalizeDbFilters(filters: SessionExplorerFilters = {}) {
  const date = filters.date && validDateFilters.has(filters.date) ? filters.date : allValue;

  return {
    agentType: filters.agentType ?? allValue,
    date,
    projectId: filters.projectId ?? allValue,
    risk: filters.risk ?? allValue,
    status: filters.status ?? allValue
  };
}

function mapSessionRow(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    agentLabel: agentTypeLabel(row.agent_type),
    agentType: row.agent_type,
    approvalRequestCount: Number(row.approval_request_count),
    branch: row.branch,
    decisionCount: Number(row.decision_count),
    externalSessionId: row.external_session_id ?? row.id,
    highestRisk: normalizeRisk(row.highest_risk),
    hookEventCount: Number(row.hook_event_count),
    lastSeenAt: row.last_seen_at ? toIso(row.last_seen_at) : null,
    organizationId: row.organization_id,
    ownerName: row.owner_name ?? "Unclaimed",
    pendingApprovalCount: Number(row.pending_approval_count),
    projectId: row.project_id,
    projectName: row.project_name,
    startedAt: toIso(row.started_at),
    status: row.status
  };
}

function normalizeRisk(risk: string): SessionSummary["highestRisk"] {
  if (risk === "critical" || risk === "high" || risk === "medium" || risk === "low") {
    return risk;
  }

  return "unknown";
}

function getDateRange(date: SessionDateFilter, now: string): { end: string; start: string } | null {
  if (date === "all") {
    return null;
  }

  const nowDate = new Date(now);
  if (date === "today") {
    const start = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate()));
    const end = new Date(start.getTime() + 86_400_000);

    return { end: end.toISOString(), start: start.toISOString() };
  }

  return {
    end: new Date(nowDate.getTime() + 1).toISOString(),
    start: new Date(nowDate.getTime() - 7 * 86_400_000).toISOString()
  };
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error("Configured database role is invalid.");
  }

  return `"${identifier.replaceAll('"', '""')}"`;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
