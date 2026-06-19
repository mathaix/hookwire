"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { auditEvents as seedAuditEvents, routeHealth, sessions } from "../data";
import {
  canReviewerDecide,
  createApprovalInbox,
  decideApproval,
  getPendingApprovals,
  getSelectedApproval,
  type ApprovalInboxState,
  type ApprovalRequest,
  type InboxScenario,
  type PersonaId
} from "./domain";

export function ApprovalInbox() {
  const searchParams = useSearchParams();
  const scenarioParam = searchParams.get("scenario");
  const scenario = scenarioParam === "empty" || scenarioParam === "loading" ? scenarioParam : "default";
  const persona: PersonaId = searchParams.get("persona") === "viewer" ? "viewer" : "approver";
  const selectedFromUrl = searchParams.get("select");
  const initialState = useMemo(() => {
    const nextState = createApprovalInbox({ scenario: scenario === "empty" ? "empty" : "default", persona });
    const requestedApprovalExists = nextState.approvals.some((approval) => approval.id === selectedFromUrl);

    return requestedApprovalExists ? { ...nextState, selectedApprovalId: selectedFromUrl } : nextState;
  }, [persona, scenario, selectedFromUrl]);
  const [inbox, setInbox] = useState<ApprovalInboxState>(initialState);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selected = getSelectedApproval(inbox);
  const pendingApprovals = getPendingApprovals(inbox);

  useEffect(() => {
    setInbox(initialState);
    setReason("");
    setError(null);
  }, [initialState]);

  useEffect(() => {
    setReason("");
    setError(null);
  }, [selected?.id]);

  if (scenario === "loading") {
    return <ApprovalLoadingState />;
  }

  if (scenario === "empty" || inbox.approvals.length === 0) {
    return <ApprovalEmptyState />;
  }

  function selectApproval(approvalId: string) {
    setInbox((current) => ({ ...current, selectedApprovalId: approvalId }));
  }

  function applyDecision(decision: "approved" | "denied") {
    if (!selected) {
      return;
    }

    const next = decideApproval(inbox, {
      approvalId: selected.id,
      decision,
      reason
    });

    setInbox(next.state);
    if (next.result.ok) {
      setError(null);
      setReason("");
    } else {
      setError(next.result.message);
    }
  }

  return (
    <>
      <div className="dashboard-grid">
        <section className="panel approval-list" data-testid="approval-list">
          <div className="panel-heading">
            <h2>Approval queue</h2>
            <span>{pendingApprovals.length} pending</span>
          </div>
          <div className="table-wrap">
            <table aria-label="Approval inbox requests">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Project</th>
                  <th>Agent</th>
                  <th>Risk</th>
                  <th>Status</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                {inbox.approvals.map((approval) => (
                  <ApprovalRow
                    approval={approval}
                    isSelected={selected?.id === approval.id}
                    key={approval.id}
                    onSelect={selectApproval}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <ApprovalDetail
          approval={selected}
          canDecide={selected ? canReviewerDecide(inbox, selected) : false}
          error={error}
          isUnauthorized={Boolean(selected && selected.status === "pending" && !inbox.reviewer.canApprove)}
          onApprove={() => applyDecision("approved")}
          onDeny={() => applyDecision("denied")}
          reason={reason}
          setReason={setReason}
        />
      </div>

      <div className="operations-grid">
        <section className="panel" data-testid="session-activity">
          <div className="panel-heading">
            <h2>Session activity</h2>
            <span>live</span>
          </div>
          <ul className="stack-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <strong>{session.id}</strong>
                <span>
                  {session.agent} · {session.status}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel" data-testid="route-health">
          <div className="panel-heading">
            <h2>Route health</h2>
            <span>targets</span>
          </div>
          <ul className="stack-list">
            {routeHealth.map((route) => (
              <li key={route.name}>
                <strong>{route.name}</strong>
                <span>
                  {route.target} · {route.status} · {route.latency}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Audit activity</h2>
            <span>recent</span>
          </div>
          <ul className="stack-list" data-testid="audit-events">
            {inbox.auditEvents.map((event) => (
              <li key={event.id}>
                <strong>{event.eventType}</strong>
                <span>
                  {event.actorUserId} · {event.createdAt}
                </span>
              </li>
            ))}
            {seedAuditEvents.map((event) => (
              <li key={`${event.event}-${event.time}`}>
                <strong>{event.event}</strong>
                <span>
                  {event.actor} · {event.time}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function ApprovalRow({
  approval,
  isSelected,
  onSelect
}: {
  approval: ApprovalRequest;
  isSelected: boolean;
  onSelect: (approvalId: string) => void;
}) {
  return (
    <tr className={isSelected ? "selected-row" : undefined}>
      <td>
        <button
          aria-label={`Review ${approval.id}`}
          className="row-select"
          onClick={() => onSelect(approval.id)}
          type="button"
        >
          <strong>{approval.id}</strong>
          <span>{approval.actionSummary}</span>
        </button>
      </td>
      <td>
        <strong>{approval.project}</strong>
        <span>{approval.policy}</span>
      </td>
      <td>{approval.agent}</td>
      <td>
        <span className={`risk risk-${approval.riskLevel}`}>{toTitle(approval.riskLevel)}</span>
      </td>
      <td>
        <span className={`status-pill status-${approval.status}`} data-testid={`approval-status-${approval.id}`}>
          {toTitle(approval.status)}
        </span>
      </td>
      <td>{approval.requestedLabel}</td>
    </tr>
  );
}

function ApprovalDetail({
  approval,
  canDecide,
  error,
  isUnauthorized,
  onApprove,
  onDeny,
  reason,
  setReason
}: {
  approval: ApprovalRequest | null;
  canDecide: boolean;
  error: string | null;
  isUnauthorized: boolean;
  onApprove: () => void;
  onDeny: () => void;
  reason: string;
  setReason: (reason: string) => void;
}) {
  if (!approval) {
    return null;
  }

  const isExpired = approval.status === "expired";
  const isCompleted = approval.status === "approved" || approval.status === "denied";
  const disabled = !canDecide;

  return (
    <aside className="panel detail-panel" data-testid="approval-detail">
      <div className="panel-heading">
        <h2>{approval.id}</h2>
        <span className={`status-pill status-${approval.status}`}>{toTitle(approval.status)}</span>
      </div>

      {isUnauthorized ? (
        <p className="state-banner state-banner-warning">Unauthorized reviewer for this route.</p>
      ) : null}
      {isExpired ? (
        <p className="state-banner state-banner-warning">This request expired before a decision was recorded.</p>
      ) : null}
      {isCompleted ? (
        <p className="state-banner state-banner-success">Completed with a one-time {approval.status} decision.</p>
      ) : null}

      <dl className="detail-list detail-list-grid">
        <div>
          <dt>Project</dt>
          <dd>{approval.project}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>{approval.agent}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>{approval.agentSessionId}</dd>
        </div>
        <div>
          <dt>Requested by</dt>
          <dd>{approval.requester}</dd>
        </div>
        <div>
          <dt>Policy</dt>
          <dd>{approval.policy}</dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>{approval.route}</dd>
        </div>
      </dl>

      <p className="decision-copy">{approval.actionSummary}</p>

      <section className="payload-block" aria-label="Redacted payload">
        <div>
          <strong>Redacted payload</strong>
          <span>Secrets are removed before reviewer display.</span>
        </div>
        <pre>{JSON.stringify(approval.redactedPayload, null, 2)}</pre>
      </section>

      <label className="reason-field">
        <span>Decision reason</span>
        <textarea
          aria-label="Decision reason"
          disabled={isCompleted || isExpired}
          onChange={(event) => setReason(event.target.value)}
          placeholder={approval.requireDenyReason ? "Required for denial" : "Optional context for denial"}
          value={reason}
        />
      </label>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="decision-actions">
        <button
          aria-label={`Approve ${approval.id} once`}
          className="approve"
          disabled={disabled}
          onClick={onApprove}
          type="button"
        >
          Approve once
        </button>
        <button
          aria-label={`Deny ${approval.id} once`}
          className="deny"
          disabled={disabled}
          onClick={onDeny}
          type="button"
        >
          Deny
        </button>
      </div>
    </aside>
  );
}

function ApprovalEmptyState() {
  return (
    <section className="panel approval-state-panel" data-testid="approval-empty-state">
      <h2>No approval requests</h2>
      <p>There are no pending, completed, or expired approval requests for this project.</p>
    </section>
  );
}

function ApprovalLoadingState() {
  return (
    <section className="panel approval-state-panel" data-testid="approval-loading-state">
      <h2>Loading approval requests</h2>
      <p>Fetching the latest web inbox state for this project.</p>
    </section>
  );
}

function toTitle(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
