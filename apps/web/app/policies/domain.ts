export type PolicyDecision = "allow" | "deny" | "ask" | "route";
export type PolicyDefaultDecision = "allow" | "deny" | "ask";
export type PolicyOverrideScope = "once" | "session" | "project";
export type PolicyStatus = "draft" | "active" | "archived";
export type PolicyRiskTag = "unknown" | "low" | "medium" | "high" | "critical";
export type RuleMoveDirection = "up" | "down";

export type PolicyMatcher = {
  commandPrefix?: string;
  commandPattern?: string;
  operation?: string;
  pathPattern?: string;
  riskTag?: PolicyRiskTag;
};

export type RouteOption = {
  id: string;
  name: string;
};

export type PolicyRule = {
  id: string;
  policyId: string;
  name: string;
  priority: number;
  matcher: PolicyMatcher;
  decision: PolicyDecision;
  routeId: string | null;
  localOverrideAllowed: boolean;
  requireOverrideReason: boolean;
  maxScope: PolicyOverrideScope | null;
  enabled: boolean;
};

export type PolicyRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  version: number;
  status: PolicyStatus;
  defaultDecision: PolicyDefaultDecision;
  rules: PolicyRule[];
};

export type PolicyBuilderState = {
  policies: PolicyRecord[];
  routeOptions: RouteOption[];
  selectedPolicyId: string | null;
  selectedRuleId: string | null;
};

export type PolicyEvent = {
  command?: string;
  operation?: string;
  path?: string;
  riskTag?: PolicyRiskTag;
};

export type PolicyEvaluation = {
  decision: PolicyDecision | PolicyDefaultDecision;
  localOverrideAllowed: boolean;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
  requireOverrideReason: boolean;
  routeId: string | null;
};

export type PolicyBundle = {
  schemaVersion: 1;
  policyId: string;
  policyName: string;
  projectId: string;
  version: number;
  defaultDecision: PolicyDefaultDecision;
  routes: RouteOption[];
  rules: Array<{
    id: string;
    name: string;
    priority: number;
    matcher: PolicyMatcher;
    decision: PolicyDecision;
    routeId: string | null;
    localOverrideAllowed: boolean;
    requireOverrideReason: boolean;
    maxScope: PolicyOverrideScope | null;
    enabled: boolean;
  }>;
};

export type RuleInput = {
  name: string;
  matcher: PolicyMatcher;
  decision: PolicyDecision;
  routeId?: string | null;
  localOverrideAllowed?: boolean;
  requireOverrideReason?: boolean;
  maxScope?: PolicyOverrideScope | null;
  enabled?: boolean;
};

const seedPolicyId = "policy-default-write-guard";
const fixedOrganizationId = "org-acme";
const fixedProjectId = "project-hookwire-web";

export function createPolicyBuilder(): PolicyBuilderState {
  const routeOptions = [
    { id: "route-web-inbox", name: "Web inbox" },
    { id: "route-on-call", name: "On-call reviewers" }
  ];
  const policy: PolicyRecord = {
    id: seedPolicyId,
    organizationId: fixedOrganizationId,
    projectId: fixedProjectId,
    name: "Default write guard",
    version: 3,
    status: "active",
    defaultDecision: "ask",
    rules: [
      {
        id: "rule-prod-delete",
        policyId: seedPolicyId,
        name: "Deny production deletes",
        priority: 10,
        matcher: {
          commandPattern: "^rm\\s+-rf\\s+/",
          operation: "shell",
          riskTag: "critical"
        },
        decision: "deny",
        routeId: null,
        localOverrideAllowed: false,
        requireOverrideReason: false,
        maxScope: null,
        enabled: true
      },
      {
        id: "rule-config-write",
        policyId: seedPolicyId,
        name: "Ask for config writes",
        priority: 20,
        matcher: {
          operation: "write_file",
          pathPattern: ".hookwire/**",
          riskTag: "medium"
        },
        decision: "ask",
        routeId: null,
        localOverrideAllowed: true,
        requireOverrideReason: true,
        maxScope: "once",
        enabled: true
      },
      {
        id: "rule-safe-read",
        policyId: seedPolicyId,
        name: "Allow safe reads",
        priority: 30,
        matcher: {
          commandPrefix: "npm run",
          operation: "shell",
          pathPattern: "package.json",
          riskTag: "low"
        },
        decision: "allow",
        routeId: null,
        localOverrideAllowed: false,
        requireOverrideReason: false,
        maxScope: null,
        enabled: true
      },
      {
        id: "rule-prod-route",
        policyId: seedPolicyId,
        name: "Route production deploys",
        priority: 40,
        matcher: {
          commandPattern: "^npm run deploy(:prod)?$",
          operation: "shell",
          pathPattern: "deploy/**",
          riskTag: "high"
        },
        decision: "route",
        routeId: "route-on-call",
        localOverrideAllowed: true,
        requireOverrideReason: true,
        maxScope: "session",
        enabled: true
      }
    ]
  };

  return {
    policies: [policy],
    routeOptions,
    selectedPolicyId: policy.id,
    selectedRuleId: policy.rules[0].id
  };
}

export function getSelectedPolicy(state: PolicyBuilderState): PolicyRecord | null {
  return state.policies.find((policy) => policy.id === state.selectedPolicyId) ?? state.policies[0] ?? null;
}

export function addPolicyRule(state: PolicyBuilderState, input: RuleInput): PolicyBuilderState {
  const policy = getSelectedPolicy(state);
  if (!policy) {
    return state;
  }

  const sortedRules = sortRules(policy.rules);
  const nextPriority = (sortedRules.at(-1)?.priority ?? 0) + 10;
  const rule = normalizeRuleInput({
    ...input,
    id: `rule-${slugify(input.name)}-${nextPriority}`,
    policyId: policy.id,
    priority: nextPriority
  });

  return updatePolicy(state, policy.id, {
    rules: sortRules([...policy.rules, rule]),
    version: policy.version + 1
  }, rule.id);
}

export function updatePolicyRule(
  state: PolicyBuilderState,
  ruleId: string,
  patch: Partial<RuleInput>
): PolicyBuilderState {
  const policy = getSelectedPolicy(state);
  if (!policy) {
    return state;
  }

  const rules = policy.rules.map((rule) =>
    rule.id === ruleId
      ? normalizeRuleInput({
          ...rule,
          ...patch,
          id: rule.id,
          policyId: rule.policyId,
          priority: rule.priority
        })
      : rule
  );

  return updatePolicy(state, policy.id, { rules: sortRules(rules), version: policy.version + 1 }, ruleId);
}

export function reorderPolicyRule(
  state: PolicyBuilderState,
  ruleId: string,
  direction: RuleMoveDirection
): PolicyBuilderState {
  const policy = getSelectedPolicy(state);
  if (!policy) {
    return state;
  }

  const sortedRules = sortRules(policy.rules);
  const index = sortedRules.findIndex((rule) => rule.id === ruleId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= sortedRules.length) {
    return state;
  }

  const current = sortedRules[index];
  const target = sortedRules[targetIndex];
  const nextRules = sortedRules.map((rule) => {
    if (rule.id === current.id) {
      return { ...rule, priority: target.priority };
    }

    if (rule.id === target.id) {
      return { ...rule, priority: current.priority };
    }

    return rule;
  });

  return updatePolicy(state, policy.id, { rules: sortRules(nextRules), version: policy.version + 1 }, ruleId);
}

export function evaluatePolicy(policy: PolicyRecord, event: PolicyEvent): PolicyEvaluation {
  const matched = sortRules(policy.rules).find((rule) => rule.enabled && matchesRule(rule, event));

  if (!matched) {
    return {
      decision: policy.defaultDecision,
      localOverrideAllowed: false,
      matchedRuleId: null,
      matchedRuleName: null,
      requireOverrideReason: false,
      routeId: null
    };
  }

  return {
    decision: matched.decision,
    localOverrideAllowed: matched.localOverrideAllowed,
    matchedRuleId: matched.id,
    matchedRuleName: matched.name,
    requireOverrideReason: matched.requireOverrideReason,
    routeId: matched.routeId
  };
}

export function serializePolicyBundle(policy: PolicyRecord, routeOptions: RouteOption[]): PolicyBundle {
  const enabledRules = sortRules(policy.rules).filter((rule) => rule.enabled);
  const routeIds = new Set(enabledRules.flatMap((rule) => (rule.routeId ? [rule.routeId] : [])));

  return {
    schemaVersion: 1,
    policyId: policy.id,
    policyName: policy.name,
    projectId: policy.projectId,
    version: policy.version,
    defaultDecision: policy.defaultDecision,
    routes: routeOptions.filter((route) => routeIds.has(route.id)).sort((a, b) => a.name.localeCompare(b.name)),
    rules: enabledRules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      matcher: compactMatcher(rule.matcher),
      decision: rule.decision,
      routeId: rule.routeId,
      localOverrideAllowed: rule.localOverrideAllowed,
      requireOverrideReason: rule.requireOverrideReason,
      maxScope: rule.maxScope,
      enabled: rule.enabled
    }))
  };
}

export function sortRules(rules: PolicyRule[]): PolicyRule[] {
  return [...rules].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

function matchesRule(rule: PolicyRule, event: PolicyEvent): boolean {
  const matcher = rule.matcher;

  if (matcher.commandPrefix && !event.command?.startsWith(matcher.commandPrefix)) {
    return false;
  }

  if (matcher.commandPattern && !safeRegexTest(matcher.commandPattern, event.command ?? "")) {
    return false;
  }

  if (matcher.operation && matcher.operation !== event.operation) {
    return false;
  }

  if (matcher.pathPattern && !globMatches(matcher.pathPattern, event.path ?? "")) {
    return false;
  }

  if (matcher.riskTag && matcher.riskTag !== event.riskTag) {
    return false;
  }

  return true;
}

function normalizeRuleInput(input: RuleInput & { id: string; policyId: string; priority: number }): PolicyRule {
  const decision = input.decision;
  const routeId = decision === "route" ? input.routeId ?? null : null;
  const localOverrideAllowed = Boolean(input.localOverrideAllowed);
  const requireOverrideReason = localOverrideAllowed && Boolean(input.requireOverrideReason);
  const matcher = compactMatcher(input.matcher);
  const maxScope = localOverrideAllowed ? input.maxScope ?? null : null;

  if (decision === "route" && !routeId) {
    throw new Error("Route decisions require a route.");
  }

  if (Object.keys(matcher).length === 0) {
    throw new Error("At least one matcher is required.");
  }

  if (maxScope && !isOverrideScope(maxScope)) {
    throw new Error("Override scope is invalid.");
  }

  return {
    id: input.id,
    policyId: input.policyId,
    name: input.name.trim(),
    priority: input.priority,
    matcher,
    decision,
    routeId,
    localOverrideAllowed,
    requireOverrideReason,
    maxScope,
    enabled: input.enabled ?? true
  };
}

function updatePolicy(
  state: PolicyBuilderState,
  policyId: string,
  patch: Partial<PolicyRecord>,
  selectedRuleId: string | null
): PolicyBuilderState {
  return {
    ...state,
    policies: state.policies.map((policy) => (policy.id === policyId ? { ...policy, ...patch } : policy)),
    selectedRuleId
  };
}

function compactMatcher(matcher: PolicyMatcher): PolicyMatcher {
  return Object.fromEntries(
    Object.entries(matcher)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
      .filter(([, value]) => value !== undefined && value !== "")
  ) as PolicyMatcher;
}

function globMatches(pattern: string, value: string): boolean {
  const escaped = pattern
    .split("**")
    .map((part) => part.split("*").map(escapeRegExp).join("[^/]*"))
    .join(".*");

  return new RegExp(`^${escaped}$`).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function safeRegexTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function isOverrideScope(value: string): value is PolicyOverrideScope {
  return value === "once" || value === "session" || value === "project";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
