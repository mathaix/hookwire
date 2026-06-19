import { AppShell } from "./app-shell";
import { approvals, auditEvents, integrations, policies, routeHealth, sessions, type SectionKey } from "./data";

type SectionPageProps = {
  active: SectionKey;
  title: string;
  description: string;
};

export function SectionPage({ active, title, description }: SectionPageProps) {
  return (
    <AppShell active={active} description={description} title={title}>
      <section className="panel section-panel">
        <div className="panel-heading">
          <h2>Workspace view</h2>
          <span>current data</span>
        </div>
        {active === "sessions" ? <SessionsTable /> : null}
        {active === "policies" ? <PoliciesTable /> : null}
        {active === "routes" ? <RoutesTable /> : null}
        {active === "integrations" ? <IntegrationsTable /> : null}
        {active === "audit" ? <AuditList /> : null}
        {active === "settings" ? <SettingsList /> : null}
      </section>
    </AppShell>
  );
}

function SessionsTable() {
  return (
    <div className="table-wrap section-table-wrap" data-testid="section-table-wrap">
      <table aria-label="Agent sessions">
        <thead>
          <tr>
            <th>Session</th>
            <th>Agent</th>
            <th>Owner</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id}>
              <td>{session.id}</td>
              <td>{session.agent}</td>
              <td>{session.owner}</td>
              <td>{session.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PoliciesTable() {
  return (
    <div className="table-wrap section-table-wrap" data-testid="section-table-wrap">
      <table aria-label="Policies">
        <thead>
          <tr>
            <th>Policy</th>
            <th>Status</th>
            <th>Rules</th>
            <th>Default</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((policy) => (
            <tr key={policy.name}>
              <td>{policy.name}</td>
              <td>{policy.status}</td>
              <td>{policy.rules}</td>
              <td>{policy.defaultDecision}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoutesTable() {
  return (
    <div className="table-wrap section-table-wrap" data-testid="section-table-wrap">
      <table aria-label="Routes">
        <thead>
          <tr>
            <th>Route</th>
            <th>Target</th>
            <th>Status</th>
            <th>Latency</th>
          </tr>
        </thead>
        <tbody>
          {routeHealth.map((route) => (
            <tr key={route.name}>
              <td>{route.name}</td>
              <td>{route.target}</td>
              <td>{route.status}</td>
              <td>{route.latency}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IntegrationsTable() {
  return (
    <div className="table-wrap section-table-wrap" data-testid="section-table-wrap">
      <table aria-label="Integrations">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Status</th>
            <th>Owner</th>
          </tr>
        </thead>
        <tbody>
          {integrations.map((integration) => (
            <tr key={integration.provider}>
              <td>{integration.provider}</td>
              <td>{integration.status}</td>
              <td>{integration.owner}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditList() {
  return (
    <ul className="stack-list">
      {auditEvents.map((event) => (
        <li key={`${event.event}-${event.time}`}>
          <strong>{event.event}</strong>
          <span>{event.actor} · {event.time}</span>
        </li>
      ))}
    </ul>
  );
}

function SettingsList() {
  return (
    <div className="settings-grid">
      <div>
        <strong>Organization</strong>
        <span>Acme Engineering</span>
      </div>
      <div>
        <strong>Project</strong>
        <span>hookwire/web</span>
      </div>
      <div>
        <strong>Review policy</strong>
        <span>Claude review required for functional deliverables</span>
      </div>
      <div>
        <strong>Local relay identity</strong>
        <span>Public-key registration pending installer work</span>
      </div>
    </div>
  );
}
