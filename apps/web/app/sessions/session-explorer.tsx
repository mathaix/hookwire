"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { RiskLevel } from "../approvals/domain";
import {
  createSessionExplorer,
  type AgentType,
  type SessionDateFilter,
  type SessionDetail,
  type SessionExplorerFilters,
  type SessionStatus,
  type SessionSummary
} from "./domain";

const agentOptions: Array<{ label: string; value: AgentType | "all" }> = [
  { label: "All agents", value: "all" },
  { label: "Claude Code", value: "claude" },
  { label: "Codex", value: "codex" },
  { label: "OpenClaw", value: "openclaw" }
];
const statusOptions: Array<{ label: string; value: SessionStatus | "all" }> = [
  { label: "All statuses", value: "all" },
  { label: "Active", value: "active" },
  { label: "Idle", value: "idle" },
  { label: "Ended", value: "ended" },
  { label: "Errored", value: "errored" }
];
const riskOptions: Array<{ label: string; value: RiskLevel | "unknown" | "all" }> = [
  { label: "All risks", value: "all" },
  { label: "Critical", value: "critical" },
  { label: "High", value: "high" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
  { label: "Unknown", value: "unknown" }
];
const dateOptions: Array<{ label: string; value: SessionDateFilter }> = [
  { label: "All dates", value: "all" },
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "last7d" }
];

export function SessionExplorer() {
  const searchParams = useSearchParams();
  const initialFilters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
  const initialSelectedSessionId = searchParams.get("session");
  const [filters, setFilters] = useState<SessionExplorerFilters>(initialFilters);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initialSelectedSessionId);
  const explorer = createSessionExplorer({ filters, selectedSessionId });

  function updateFilter<Key extends keyof SessionExplorerFilters>(key: Key, value: SessionExplorerFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedSessionId(null);
  }

  return (
    <>
      <section className="panel session-filters" aria-label="Session filters">
        <label>
          <span>Project</span>
          <select
            aria-label="Project"
            onChange={(event) => updateFilter("projectId", event.target.value)}
            value={explorer.filters.projectId}
          >
            <option value="all">All projects</option>
            {explorer.projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <FilterSelect
          label="Agent"
          onChange={(value) => updateFilter("agentType", value as AgentType | "all")}
          options={agentOptions}
          value={explorer.filters.agentType}
        />
        <FilterSelect
          label="Status"
          onChange={(value) => updateFilter("status", value as SessionStatus | "all")}
          options={statusOptions}
          value={explorer.filters.status}
        />
        <FilterSelect
          label="Risk"
          onChange={(value) => updateFilter("risk", value as RiskLevel | "unknown" | "all")}
          options={riskOptions}
          value={explorer.filters.risk}
        />
        <FilterSelect
          label="Date"
          onChange={(value) => updateFilter("date", value as SessionDateFilter)}
          options={dateOptions}
          value={explorer.filters.date}
        />
      </section>

      <section className="session-metrics" data-testid="session-metrics">
        <Metric value={`${explorer.metrics.total} total`} label="Sessions" />
        <Metric value={`${explorer.metrics.active} active`} label="Running now" />
        <Metric value={`${explorer.metrics.highRisk} high risk`} label="Risk watch" />
        <Metric value={`${explorer.metrics.pendingApprovals} pending`} label="Approvals" />
      </section>

      {explorer.sessions.length === 0 ? (
        <section className="panel session-empty-state" data-testid="session-empty-state">
          <h2>No sessions match these filters</h2>
          <p>Adjust the project, agent, status, risk, or date filters to inspect more agent sessions.</p>
        </section>
      ) : (
        <div className="session-grid">
          <section className="panel session-list" data-testid="session-list">
            <div className="panel-heading">
              <h2>Agent activity</h2>
              <span>
                {explorer.metrics.agents.claude} Claude · {explorer.metrics.agents.codex} Codex ·{" "}
                {explorer.metrics.agents.openclaw} OpenClaw
              </span>
            </div>
            <div className="table-wrap" data-testid="section-table-wrap">
              <table aria-label="Agent sessions">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Project</th>
                    <th>Agent</th>
                    <th>Status</th>
                    <th>Risk</th>
                    <th>Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {explorer.sessions.map((session) => (
                    <SessionRow
                      isSelected={explorer.detail?.externalSessionId === session.externalSessionId}
                      key={session.id}
                      onSelect={setSelectedSessionId}
                      session={session}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <SessionDetailPanel detail={explorer.detail} />
        </div>
      )}
    </>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <select aria-label={label} onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-tile">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function SessionRow({
  isSelected,
  onSelect,
  session
}: {
  isSelected: boolean;
  onSelect: (sessionId: string) => void;
  session: SessionSummary;
}) {
  return (
    <tr className={isSelected ? "selected-row" : undefined}>
      <td>
        <button
          aria-label={`Inspect ${session.externalSessionId}`}
          className="row-select"
          onClick={() => onSelect(session.externalSessionId)}
          type="button"
        >
          <strong>{session.externalSessionId}</strong>
          <span>{session.ownerName}</span>
        </button>
      </td>
      <td>
        <strong>{session.projectName}</strong>
        <span>{session.branch}</span>
      </td>
      <td>{session.agentLabel}</td>
      <td>
        <span className={`status-pill status-${session.status}`}>{toTitle(session.status)}</span>
      </td>
      <td>
        <span className={`risk risk-${session.highestRisk}`}>{toTitle(session.highestRisk)}</span>
      </td>
      <td>
        <strong>{session.hookEventCount} events</strong>
        <span>{session.approvalRequestCount} approvals</span>
        <span>{session.decisionCount} decisions</span>
      </td>
    </tr>
  );
}

function SessionDetailPanel({ detail }: { detail: SessionDetail | null }) {
  if (!detail) {
    return null;
  }

  return (
    <aside className="panel session-detail" data-testid="session-detail">
      <div className="panel-heading">
        <h2>{detail.externalSessionId}</h2>
        <span className={`status-pill status-${detail.status}`}>{toTitle(detail.status)}</span>
      </div>
      <dl className="detail-list detail-list-grid">
        <div>
          <dt>Project</dt>
          <dd>{detail.projectName}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>{detail.agentLabel}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{detail.ownerName}</dd>
        </div>
        <div>
          <dt>Highest risk</dt>
          <dd>{toTitle(detail.highestRisk)}</dd>
        </div>
      </dl>

      <LinkedList title="Hook events">
        {detail.hookEvents.map((event) => (
          <li key={event.id}>
            <strong>{event.eventType}</strong>
            <span>
              {event.toolName ?? "tool"} · {event.operation ?? "operation"} · {toTitle(event.riskLevel)}
            </span>
            <pre>{JSON.stringify(event.payload, null, 2)}</pre>
          </li>
        ))}
      </LinkedList>

      <LinkedList title="Approval requests">
        {detail.approvalRequests.map((approval) => (
          <li key={approval.id}>
            <strong>{approval.actionSummary}</strong>
            <span>
              {approval.id} · {toTitle(approval.status)} · {toTitle(approval.riskLevel)}
            </span>
          </li>
        ))}
      </LinkedList>

      <LinkedList title="Decisions">
        {detail.decisions.length === 0 ? (
          <li>
            <strong>No decisions yet</strong>
            <span>Approval requests are still pending or expired.</span>
          </li>
        ) : (
          detail.decisions.map((decision) => (
            <li key={decision.id}>
              <strong>{toTitle(decision.decision)}</strong>
              <span>
                {decision.source} · {decision.scope} · {decision.reason ?? "No reason recorded"}
              </span>
            </li>
          ))
        )}
      </LinkedList>
    </aside>
  );
}

function LinkedList({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="linked-session-section">
      <h3>{title}</h3>
      <ul className="stack-list">{children}</ul>
    </section>
  );
}

function filtersFromSearchParams(searchParams: URLSearchParams): SessionExplorerFilters {
  return {
    agentType: parseOption(searchParams.get("agent")) as AgentType | "all",
    date: parseOption(searchParams.get("date")) as SessionDateFilter,
    projectId: parseOption(searchParams.get("project")),
    risk: parseOption(searchParams.get("risk")) as RiskLevel | "unknown" | "all",
    status: parseOption(searchParams.get("status")) as SessionStatus | "all"
  };
}

function parseOption(value: string | null) {
  return value && value.length > 0 ? value : "all";
}

function toTitle(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
