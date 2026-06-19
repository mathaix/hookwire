import { AppShell } from "./app-shell";
import { approvals, auditEvents, routeHealth, sessions } from "./data";

export default function InboxPage() {
  const selected = approvals[0];

  return (
    <AppShell
      active="inbox"
      description="Review routed agent actions, inspect context, and record a decision."
      title="Pending approvals"
    >
      <div className="dashboard-grid">
        <section className="panel approval-list" data-testid="approval-list">
          <div className="panel-heading">
            <h2>Approval queue</h2>
            <span>{approvals.length} open</span>
          </div>
          <div className="table-wrap">
            <table aria-label="Pending approval requests">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Agent</th>
                  <th>Risk</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                {approvals.map((approval, index) => (
                  <tr className={index === 0 ? "selected-row" : undefined} key={approval.id}>
                    <td>
                      <strong>{approval.project}</strong>
                      <span>{approval.summary}</span>
                    </td>
                    <td>{approval.agent}</td>
                    <td>
                      <span className={`risk risk-${approval.risk.toLowerCase()}`}>{approval.risk}</span>
                    </td>
                    <td>{approval.requested}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="panel detail-panel" data-testid="approval-detail">
          <div className="panel-heading">
            <h2>{selected.id}</h2>
            <span>{selected.route}</span>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Project</dt>
              <dd>{selected.project}</dd>
            </div>
            <div>
              <dt>Agent</dt>
              <dd>{selected.agent}</dd>
            </div>
            <div>
              <dt>Session</dt>
              <dd>{selected.session}</dd>
            </div>
            <div>
              <dt>Requested by</dt>
              <dd>{selected.requester}</dd>
            </div>
          </dl>
          <p className="decision-copy">{selected.summary}</p>
          <div className="decision-actions">
            <button className="approve" type="button" aria-label="Approve selected approval">
              Approve
            </button>
            <button className="deny" type="button" aria-label="Deny selected approval">
              Deny
            </button>
          </div>
        </aside>
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
                <span>{session.agent} · {session.status}</span>
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
                <span>{route.target} · {route.status} · {route.latency}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Audit activity</h2>
            <span>recent</span>
          </div>
          <ul className="stack-list">
            {auditEvents.map((event) => (
              <li key={`${event.event}-${event.time}`}>
                <strong>{event.event}</strong>
                <span>{event.actor} · {event.time}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
