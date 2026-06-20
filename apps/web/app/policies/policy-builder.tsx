"use client";

import { useMemo, useState } from "react";
import {
  addPolicyRule,
  createPolicyBuilder,
  evaluatePolicy,
  getSelectedPolicy,
  reorderPolicyRule,
  serializePolicyBundle,
  sortRules,
  updatePolicyRule,
  type PolicyBuilderState,
  type PolicyDecision,
  type PolicyEvent,
  type PolicyMatcher,
  type PolicyOverrideScope,
  type PolicyRiskTag,
  type PolicyRule
} from "./domain";

type FormState = {
  commandPattern: string;
  commandPrefix: string;
  decision: PolicyDecision;
  localOverrideAllowed: boolean;
  maxScope: PolicyOverrideScope | "";
  name: string;
  operation: string;
  pathPattern: string;
  requireOverrideReason: boolean;
  riskTag: PolicyRiskTag | "";
  routeId: string;
};

const emptyForm: FormState = {
  commandPattern: "",
  commandPrefix: "",
  decision: "ask",
  localOverrideAllowed: false,
  maxScope: "",
  name: "",
  operation: "",
  pathPattern: "",
  requireOverrideReason: false,
  riskTag: "",
  routeId: ""
};

export function PolicyBuilder() {
  const [builder, setBuilder] = useState<PolicyBuilderState>(() => createPolicyBuilder());
  const selectedPolicy = getSelectedPolicy(builder);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [evaluationInput, setEvaluationInput] = useState<Required<PolicyEvent>>({
    command: "",
    operation: "shell",
    path: "",
    riskTag: "low"
  });
  const selectedRule = selectedPolicy?.rules.find((rule) => rule.id === builder.selectedRuleId) ?? selectedPolicy?.rules[0] ?? null;
  const sortedRules = selectedPolicy ? sortRules(selectedPolicy.rules) : [];
  const bundle = useMemo(
    () => (selectedPolicy ? serializePolicyBundle(selectedPolicy, builder.routeOptions) : null),
    [builder.routeOptions, selectedPolicy]
  );
  const evaluation = selectedPolicy ? evaluatePolicy(selectedPolicy, evaluationInput) : null;
  const canSubmit = form.name.trim().length > 0 && hasMatcher(form) && (form.decision !== "route" || Boolean(form.routeId));

  if (!selectedPolicy || !bundle) {
    return null;
  }

  function startCreate() {
    setMode("create");
    setForm(emptyForm);
  }

  function startEdit(rule: PolicyRule) {
    setMode("edit");
    setBuilder((current) => ({ ...current, selectedRuleId: rule.id }));
    setForm({
      commandPattern: rule.matcher.commandPattern ?? "",
      commandPrefix: rule.matcher.commandPrefix ?? "",
      decision: rule.decision,
      localOverrideAllowed: rule.localOverrideAllowed,
      maxScope: rule.maxScope ?? "",
      name: rule.name,
      operation: rule.matcher.operation ?? "",
      pathPattern: rule.matcher.pathPattern ?? "",
      requireOverrideReason: rule.requireOverrideReason,
      riskTag: rule.matcher.riskTag ?? "",
      routeId: rule.routeId ?? ""
    });
  }

  function submitRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    const input = {
      decision: form.decision,
      localOverrideAllowed: form.localOverrideAllowed,
      matcher: formToMatcher(form),
      maxScope: form.localOverrideAllowed ? form.maxScope || null : null,
      name: form.name,
      requireOverrideReason: form.requireOverrideReason,
      routeId: form.decision === "route" ? form.routeId || null : null
    };

    setBuilder((current) =>
      mode === "create" ? addPolicyRule(current, input) : updatePolicyRule(current, current.selectedRuleId ?? "", input)
    );
    setMode("create");
    setForm(emptyForm);
  }

  function moveRule(ruleId: string, direction: "up" | "down") {
    setBuilder((current) => reorderPolicyRule(current, ruleId, direction));
  }

  return (
    <>
      <div className="policy-grid">
        <section className="panel policy-list-panel">
          <div className="panel-heading">
            <h2>Policy catalog</h2>
            <span>{builder.policies.length} configured</span>
          </div>
          <ul className="stack-list">
            {builder.policies.map((policy) => (
              <li key={policy.id}>
                <strong>{policy.name}</strong>
                <span>
                  v{policy.version} · {policy.status} · default {policy.defaultDecision}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel policy-rules-panel" data-testid="policy-rules">
          <div className="panel-heading">
            <h2>Rule order</h2>
            <button className="secondary-action" onClick={startCreate} type="button">
              New rule
            </button>
          </div>
          <div className="table-wrap" data-testid="section-table-wrap">
            <table aria-label="Policy rules">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Rule</th>
                  <th>Matcher</th>
                  <th>Decision</th>
                  <th>Order</th>
                </tr>
              </thead>
              <tbody>
                {sortedRules.map((rule, index) => (
                  <tr className={rule.id === selectedRule?.id ? "selected-row" : undefined} key={rule.id}>
                    <td>{rule.priority}</td>
                    <td>
                      <button className="row-select" onClick={() => startEdit(rule)} type="button">
                        <strong>{rule.name}</strong>
                        <span>{rule.localOverrideAllowed ? "Local override allowed" : "No local override"}</span>
                      </button>
                    </td>
                    <td>{formatMatcher(rule.matcher)}</td>
                    <td>
                      <span className={`decision-pill decision-${rule.decision}`}>{toTitle(rule.decision)}</span>
                    </td>
                    <td>
                      <div className="order-actions">
                        <button
                          aria-label={`Move ${rule.name} up`}
                          disabled={index === 0}
                          onClick={() => moveRule(rule.id, "up")}
                          type="button"
                        >
                          Up
                        </button>
                        <button
                          aria-label={`Move ${rule.name} down`}
                          disabled={index === sortedRules.length - 1}
                          onClick={() => moveRule(rule.id, "down")}
                          type="button"
                        >
                          Down
                        </button>
                        <button aria-label={`Edit ${rule.name}`} onClick={() => startEdit(rule)} type="button">
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="policy-builder-grid">
        <section className="panel rule-form-panel">
          <div className="panel-heading">
            <h2>{mode === "create" ? "Create rule" : "Edit rule"}</h2>
            <span>{mode === "create" ? "new priority" : "selected rule"}</span>
          </div>
          <form aria-label="Rule editor" className="rule-form" onSubmit={submitRule}>
            <label>
              <span>Rule name</span>
              <input
                aria-label="Rule name"
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
                value={form.name}
              />
            </label>
            <label>
              <span>Command prefix</span>
              <input
                aria-label="Command prefix"
                onChange={(event) => setForm((current) => ({ ...current, commandPrefix: event.target.value }))}
                value={form.commandPrefix}
              />
            </label>
            <label>
              <span>Command pattern</span>
              <input
                aria-label="Command pattern"
                onChange={(event) => setForm((current) => ({ ...current, commandPattern: event.target.value }))}
                value={form.commandPattern}
              />
            </label>
            <label>
              <span>Operation</span>
              <select
                aria-label="Operation"
                onChange={(event) => setForm((current) => ({ ...current, operation: event.target.value }))}
                value={form.operation}
              >
                <option value="">Any operation</option>
                <option value="shell">shell</option>
                <option value="write_file">write_file</option>
                <option value="read_file">read_file</option>
              </select>
            </label>
            <label>
              <span>Path pattern</span>
              <input
                aria-label="Path pattern"
                onChange={(event) => setForm((current) => ({ ...current, pathPattern: event.target.value }))}
                value={form.pathPattern}
              />
            </label>
            <label>
              <span>Risk tag</span>
              <select
                aria-label="Risk tag"
                onChange={(event) =>
                  setForm((current) => ({ ...current, riskTag: event.target.value as PolicyRiskTag | "" }))
                }
                value={form.riskTag}
              >
                <option value="">Any risk</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </label>
            <label>
              <span>Decision</span>
              <select
                aria-label="Decision"
                onChange={(event) => {
                  const decision = event.target.value as PolicyDecision;
                  setForm((current) => ({ ...current, decision, routeId: decision === "route" ? current.routeId : "" }));
                }}
                value={form.decision}
              >
                <option value="allow">allow</option>
                <option value="deny">deny</option>
                <option value="ask">ask</option>
                <option value="route">route</option>
              </select>
            </label>
            <label>
              <span>Route</span>
              <select
                aria-label="Route"
                disabled={form.decision !== "route"}
                onChange={(event) => setForm((current) => ({ ...current, routeId: event.target.value }))}
                required={form.decision === "route"}
                value={form.routeId}
              >
                <option value="">Select route</option>
                {builder.routeOptions.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="check-row">
              <input
                aria-label="Allow local override"
                checked={form.localOverrideAllowed}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    localOverrideAllowed: event.target.checked,
                    maxScope: event.target.checked ? current.maxScope || "session" : "",
                    requireOverrideReason: event.target.checked ? current.requireOverrideReason : false
                  }))
                }
                type="checkbox"
              />
              <span>Allow local override</span>
            </label>
            <label>
              <span>Override scope</span>
              <select
                aria-label="Override scope"
                disabled={!form.localOverrideAllowed}
                onChange={(event) =>
                  setForm((current) => ({ ...current, maxScope: event.target.value as PolicyOverrideScope | "" }))
                }
                value={form.maxScope}
              >
                <option value="">No override scope</option>
                <option value="once">once</option>
                <option value="session">session</option>
                <option value="project">project</option>
              </select>
            </label>
            <label className="check-row">
              <input
                aria-label="Require override reason"
                checked={form.requireOverrideReason}
                disabled={!form.localOverrideAllowed}
                onChange={(event) =>
                  setForm((current) => ({ ...current, requireOverrideReason: event.target.checked }))
                }
                type="checkbox"
              />
              <span>Require override reason</span>
            </label>
            <button className="primary-action" disabled={!canSubmit} type="submit">
              {mode === "create" ? "Create rule" : "Save rule"}
            </button>
          </form>
        </section>

        <aside className="panel selected-rule-panel" data-testid="selected-rule-detail">
          <div className="panel-heading">
            <h2>{selectedRule?.name ?? "No rule selected"}</h2>
            {selectedRule ? <span>{selectedRule.priority}</span> : null}
          </div>
          {selectedRule ? (
            <dl className="detail-list detail-list-grid">
              <div>
                <dt>Decision</dt>
                <dd>{toTitle(selectedRule.decision)}</dd>
              </div>
              <div>
                <dt>Route</dt>
                <dd>{routeName(builder, selectedRule.routeId)}</dd>
              </div>
              <div>
                <dt>Override</dt>
                <dd>{selectedRule.localOverrideAllowed ? "Local override allowed" : "No local override"}</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>{selectedRule.maxScope ?? "None"}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{selectedRule.requireOverrideReason ? "Override reason required" : "No reason required"}</dd>
              </div>
            </dl>
          ) : null}
        </aside>
      </div>

      <div className="policy-output-grid">
        <section className="panel policy-simulator">
          <div className="panel-heading">
            <h2>Policy simulator</h2>
            <span>first match wins</span>
          </div>
          <div className="simulator-form">
            <label>
              <span>Simulated command</span>
              <input
                aria-label="Simulated command"
                onChange={(event) => setEvaluationInput((current) => ({ ...current, command: event.target.value }))}
                value={evaluationInput.command}
              />
            </label>
            <label>
              <span>Simulated operation</span>
              <select
                aria-label="Simulated operation"
                onChange={(event) => setEvaluationInput((current) => ({ ...current, operation: event.target.value }))}
                value={evaluationInput.operation}
              >
                <option value="shell">shell</option>
                <option value="write_file">write_file</option>
                <option value="read_file">read_file</option>
              </select>
            </label>
            <label>
              <span>Simulated path</span>
              <input
                aria-label="Simulated path"
                onChange={(event) => setEvaluationInput((current) => ({ ...current, path: event.target.value }))}
                value={evaluationInput.path}
              />
            </label>
            <label>
              <span>Simulated risk</span>
              <select
                aria-label="Simulated risk"
                onChange={(event) =>
                  setEvaluationInput((current) => ({ ...current, riskTag: event.target.value as PolicyRiskTag }))
                }
                value={evaluationInput.riskTag}
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </label>
            <button className="secondary-action" type="button">
              Evaluate policy
            </button>
          </div>
          <div className="state-banner state-banner-success" data-testid="policy-evaluation">
            {evaluation ? `${toTitle(evaluation.decision)} via ${evaluation.matchedRuleName ?? "default policy"}` : null}
          </div>
        </section>

        <section className="panel policy-bundle-panel">
          <div className="panel-heading">
            <h2>Relay bundle</h2>
            <span>serialized</span>
          </div>
          <pre data-testid="serialized-policy-bundle">{JSON.stringify(bundle, null, 2)}</pre>
        </section>
      </div>
    </>
  );
}

function formToMatcher(form: FormState): PolicyMatcher {
  return {
    commandPattern: form.commandPattern,
    commandPrefix: form.commandPrefix,
    operation: form.operation,
    pathPattern: form.pathPattern,
    riskTag: form.riskTag || undefined
  };
}

function hasMatcher(form: FormState): boolean {
  return Object.values(formToMatcher(form)).some((value) => Boolean(value));
}

function formatMatcher(matcher: PolicyMatcher): string {
  return Object.entries(matcher)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
}

function routeName(builder: PolicyBuilderState, routeId: string | null): string {
  if (!routeId) {
    return "None";
  }

  return builder.routeOptions.find((route) => route.id === routeId)?.name ?? routeId;
}

function toTitle(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
