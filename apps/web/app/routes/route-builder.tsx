"use client";

import { useMemo, useState } from "react";
import {
  addRouteTarget,
  createRouteBuilder,
  getSelectedRoute,
  integrationProviderForTarget,
  labelForTargetType,
  providerTargetTypes,
  serializeRouteConfig,
  updateRouteSettings,
  type RecipientKind,
  type RouteBuilderState,
  type RouteRecord,
  type RouteTargetType
} from "./domain";

type SettingsForm = {
  approvalsRequired: string;
  fallbackRouteId: string;
  timeoutSeconds: string;
};

type TargetForm = {
  approvalGroupId: string;
  priority: string;
  recipientKind: RecipientKind;
  targetType: RouteTargetType;
};

export function RouteBuilder() {
  const [builder, setBuilder] = useState<RouteBuilderState>(() => createRouteBuilder());
  const selectedRoute = getSelectedRoute(builder);
  const [settings, setSettings] = useState<SettingsForm>(() => settingsFromRoute(selectedRoute));
  const [targetForm, setTargetForm] = useState<TargetForm>({
    approvalGroupId: "group-engineering",
    priority: "30",
    recipientKind: "group",
    targetType: "web_inbox"
  });
  const serialized = useMemo(() => serializeRouteConfig(builder), [builder]);

  if (!selectedRoute) {
    return null;
  }
  const selectedRouteId = selectedRoute.id;

  function selectRoute(route: RouteRecord) {
    setBuilder((current) => ({ ...current, selectedRouteId: route.id, selectedTargetId: route.targets[0]?.id ?? null }));
    setSettings(settingsFromRoute(route));
  }

  function saveRoute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBuilder((current) =>
      updateRouteSettings(current, selectedRouteId, {
        approvalsRequired: Number(settings.approvalsRequired),
        fallbackRouteId: settings.fallbackRouteId || null,
        timeoutSeconds: Number(settings.timeoutSeconds)
      })
    );
  }

  function addTarget(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const integrationId = integrationIdForTarget(builder, targetForm.targetType);
    setBuilder((current) =>
      addRouteTarget(current, {
        approvalGroupId: targetForm.recipientKind === "system" ? null : targetForm.approvalGroupId || null,
        config: {
          providerStatus: targetForm.targetType === "web_inbox" || targetForm.targetType === "local_terminal" ? "active" : "modeled",
          recipientKind: targetForm.recipientKind
        },
        integrationId,
        priority: Number(targetForm.priority),
        targetType: targetForm.targetType
      })
    );
    setTargetForm((current) => ({ ...current, priority: String(Number(current.priority) + 10) }));
  }

  return (
    <>
      <div className="route-grid">
        <section className="panel route-list-panel">
          <div className="panel-heading">
            <h2>Route catalog</h2>
            <span>{builder.routes.length} configured</span>
          </div>
          <div className="table-wrap">
            <table aria-label="Routes">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Approvals</th>
                  <th>Fallback</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {builder.routes.map((route) => (
                  <tr className={route.id === selectedRoute.id ? "selected-row" : undefined} key={route.id}>
                    <td>
                      <button className="row-select" onClick={() => selectRoute(route)} type="button">
                        <strong>{route.name}</strong>
                        <span>{route.description}</span>
                      </button>
                    </td>
                    <td>{route.approvalsRequired}</td>
                    <td>{routeName(builder, route.fallbackRouteId)}</td>
                    <td>
                      <span className={`status-pill ${route.enabled ? "status-active" : "status-disabled"}`}>
                        {route.enabled ? "Active" : "Disabled"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel route-targets-panel">
          <div className="panel-heading">
            <h2>Route targets</h2>
            <span>priority order</span>
          </div>
          <div className="table-wrap">
            <table aria-label="Route targets">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Target</th>
                  <th>Recipient</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {selectedRoute.targets.map((target) => (
                  <tr key={target.id}>
                    <td>{target.priority}</td>
                    <td>
                      <strong>{target.targetType}</strong>
                      <span>{target.integrationName ?? labelForTargetType(target.targetType)}</span>
                    </td>
                    <td>
                      <strong>{target.approvalGroupName ?? "System"}</strong>
                      <span>
                        {target.config.recipientKind ?? "system"}
                        {target.currentOnCallUserName ? ` · current owner ${target.currentOnCallUserName}` : ""}
                      </span>
                    </td>
                    <td>
                      <span className="status-pill status-idle">
                        {target.config.providerStatus === "active" ? "active" : "modeled"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="route-builder-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Route settings</h2>
            <span>{selectedRoute.name}</span>
          </div>
          <form aria-label="Route settings" className="route-form" onSubmit={saveRoute}>
            <label>
              <span>Approvals required</span>
              <input
                aria-label="Approvals required"
                min="1"
                onChange={(event) => setSettings((current) => ({ ...current, approvalsRequired: event.target.value }))}
                type="number"
                value={settings.approvalsRequired}
              />
            </label>
            <label>
              <span>Timeout seconds</span>
              <input
                aria-label="Timeout seconds"
                min="1"
                onChange={(event) => setSettings((current) => ({ ...current, timeoutSeconds: event.target.value }))}
                type="number"
                value={settings.timeoutSeconds}
              />
            </label>
            <label>
              <span>Fallback route</span>
              <select
                aria-label="Fallback route"
                onChange={(event) => setSettings((current) => ({ ...current, fallbackRouteId: event.target.value }))}
                value={settings.fallbackRouteId}
              >
                <option value="">No fallback</option>
                {builder.routes
                  .filter((route) => route.id !== selectedRoute.id)
                  .map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.name}
                    </option>
                  ))}
              </select>
            </label>
            <button className="primary-action" type="submit">
              Save route
            </button>
          </form>
        </section>

        <aside className="panel selected-route-panel" data-testid="selected-route-detail">
          <div className="panel-heading">
            <h2>{selectedRoute.name}</h2>
            <span>{selectedRoute.enabled ? "active" : "disabled"}</span>
          </div>
          <dl className="detail-list detail-list-grid">
            <div>
              <dt>Approvals</dt>
              <dd>{selectedRoute.approvalsRequired} approvals</dd>
            </div>
            <div>
              <dt>Timeout</dt>
              <dd>{selectedRoute.timeoutSeconds} seconds</dd>
            </div>
            <div>
              <dt>Fallback</dt>
              <dd>{routeName(builder, selectedRoute.fallbackRouteId)}</dd>
            </div>
            <div>
              <dt>Targets</dt>
              <dd>{selectedRoute.targets.length}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <div className="route-builder-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Target editor</h2>
            <span>provider neutral</span>
          </div>
          <form aria-label="Target editor" className="route-form" onSubmit={addTarget}>
            <label>
              <span>Target type</span>
              <select
                aria-label="Target type"
                onChange={(event) =>
                  setTargetForm((current) => ({
                    ...current,
                    targetType: event.target.value as RouteTargetType
                  }))
                }
                value={targetForm.targetType}
              >
                {providerTargetTypes.map((targetType) => (
                  <option key={targetType} value={targetType}>
                    {labelForTargetType(targetType)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Approval group</span>
              <select
                aria-label="Approval group"
                disabled={targetForm.recipientKind === "system"}
                onChange={(event) => setTargetForm((current) => ({ ...current, approvalGroupId: event.target.value }))}
                value={targetForm.approvalGroupId}
              >
                {builder.approvalGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Recipient mode</span>
              <select
                aria-label="Recipient mode"
                onChange={(event) =>
                  setTargetForm((current) => ({ ...current, recipientKind: event.target.value as RecipientKind }))
                }
                value={targetForm.recipientKind}
              >
                <option value="group">group</option>
                <option value="on_call">on_call</option>
                <option value="system">system</option>
              </select>
            </label>
            <label>
              <span>Target priority</span>
              <input
                aria-label="Target priority"
                min="1"
                onChange={(event) => setTargetForm((current) => ({ ...current, priority: event.target.value }))}
                type="number"
                value={targetForm.priority}
              />
            </label>
            <button className="primary-action" type="submit">
              Add target
            </button>
          </form>
        </section>

        <section className="panel provider-matrix-panel" data-testid="provider-matrix">
          <div className="panel-heading">
            <h2>Provider status</h2>
            <span>worker placeholders</span>
          </div>
          <div className="provider-grid">
            {serialized.providerMatrix.map((provider) => (
              <div key={provider.targetType}>
                <strong>{provider.label}</strong>
                <span>{provider.status}</span>
                <span>{provider.workerStatus}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel policy-bundle-panel">
        <div className="panel-heading">
          <h2>Route fixture</h2>
          <span>serialized</span>
        </div>
        <pre data-testid="serialized-route-config">{JSON.stringify(serialized, null, 2)}</pre>
      </section>
    </>
  );
}

function settingsFromRoute(route: RouteRecord | null): SettingsForm {
  return {
    approvalsRequired: String(route?.approvalsRequired ?? 1),
    fallbackRouteId: route?.fallbackRouteId ?? "",
    timeoutSeconds: String(route?.timeoutSeconds ?? 900)
  };
}

function routeName(builder: RouteBuilderState, routeId: string | null): string {
  if (!routeId) {
    return "None";
  }

  return builder.routes.find((route) => route.id === routeId)?.name ?? routeId;
}

function integrationIdForTarget(builder: RouteBuilderState, targetType: RouteTargetType): string | null {
  const provider = integrationProviderForTarget(targetType);
  if (!provider) {
    return null;
  }

  return builder.integrations.find((integration) => integration.provider === provider)?.id ?? null;
}
