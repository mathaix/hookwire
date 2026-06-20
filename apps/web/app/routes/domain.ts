export const providerTargetTypes = [
  "web_inbox",
  "slack",
  "sms",
  "jira",
  "linear",
  "email",
  "github",
  "webhook",
  "local_terminal"
] as const;

export type RouteTargetType = (typeof providerTargetTypes)[number];
export type IntegrationProvider = "slack" | "twilio" | "jira" | "linear" | "email" | "github" | "webhook";
export type IntegrationStatus = "inactive" | "active" | "error" | "disabled";
export type RecipientKind = "group" | "on_call" | "system";
export type ProviderStatus = "active" | "modeled" | "worker_pending" | "disabled";

export type ApprovalGroupOption = {
  id: string;
  name: string;
  currentOnCallUserName?: string | null;
};

export type IntegrationOption = {
  id: string;
  name: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
};

export type RouteTargetConfig = {
  channel?: string;
  providerStatus?: ProviderStatus;
  recipientKind?: RecipientKind;
};

export type RouteTargetRecord = {
  id: string;
  routeId: string;
  targetType: RouteTargetType;
  integrationId: string | null;
  integrationName?: string | null;
  integrationStatus?: IntegrationStatus | null;
  approvalGroupId: string | null;
  approvalGroupName?: string | null;
  currentOnCallUserName?: string | null;
  config: RouteTargetConfig;
  priority: number;
  enabled: boolean;
};

export type RouteRecord = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  approvalsRequired: number;
  timeoutSeconds: number;
  fallbackRouteId: string | null;
  enabled: boolean;
  targets: RouteTargetRecord[];
};

export type RouteBuilderState = {
  approvalGroups: ApprovalGroupOption[];
  integrations: IntegrationOption[];
  routes: RouteRecord[];
  selectedRouteId: string | null;
  selectedTargetId: string | null;
};

export type RouteInput = {
  approvalsRequired?: number;
  description?: string | null;
  enabled?: boolean;
  fallbackRouteId?: string | null;
  name?: string;
  timeoutSeconds?: number;
};

export type RouteTargetInput = {
  approvalGroupId?: string | null;
  config?: RouteTargetConfig;
  enabled?: boolean;
  integrationId?: string | null;
  priority: number;
  targetType: RouteTargetType;
};

export type SerializedRouteConfig = {
  schemaVersion: 1;
  providerMatrix: Array<{
    targetType: RouteTargetType;
    label: string;
    status: ProviderStatus;
    workerStatus: string;
  }>;
  routes: Array<{
    id: string;
    name: string;
    approvalsRequired: number;
    timeoutSeconds: number;
    fallbackRouteId: string | null;
    enabled: boolean;
    targets: RouteTargetRecord[];
  }>;
};

const fixedOrganizationId = "org-acme";

export function createRouteBuilder(): RouteBuilderState {
  const approvalGroups: ApprovalGroupOption[] = [
    { id: "group-engineering", name: "Engineering reviewers", currentOnCallUserName: "Maya" },
    { id: "group-release", name: "Release on-call", currentOnCallUserName: "Maya" }
  ];
  const integrations: IntegrationOption[] = [
    { id: "integration-slack", name: "Slack workspace", provider: "slack", status: "inactive" },
    { id: "integration-twilio", name: "SMS sender", provider: "twilio", status: "inactive" },
    { id: "integration-jira", name: "Jira site", provider: "jira", status: "inactive" },
    { id: "integration-linear", name: "Linear workspace", provider: "linear", status: "inactive" },
    { id: "integration-email", name: "Email relay", provider: "email", status: "inactive" },
    { id: "integration-github", name: "GitHub org", provider: "github", status: "inactive" },
    { id: "integration-webhook", name: "Webhook endpoint", provider: "webhook", status: "inactive" }
  ];
  const routes: RouteRecord[] = [
    {
      id: "route-web-inbox",
      organizationId: fixedOrganizationId,
      name: "Web inbox",
      description: "Browser approval queue",
      approvalsRequired: 1,
      timeoutSeconds: 900,
      fallbackRouteId: "route-on-call",
      enabled: true,
      targets: [
        {
          id: "target-web-inbox",
          routeId: "route-web-inbox",
          targetType: "web_inbox",
          integrationId: null,
          integrationName: null,
          integrationStatus: null,
          approvalGroupId: "group-engineering",
          approvalGroupName: "Engineering reviewers",
          currentOnCallUserName: null,
          config: { providerStatus: "active", recipientKind: "group" },
          priority: 10,
          enabled: true
        },
        {
          id: "target-slack-on-call",
          routeId: "route-web-inbox",
          targetType: "slack",
          integrationId: "integration-slack",
          integrationName: "Slack workspace",
          integrationStatus: "inactive",
          approvalGroupId: "group-release",
          approvalGroupName: "Release on-call",
          currentOnCallUserName: "Maya",
          config: { providerStatus: "modeled", recipientKind: "on_call" },
          priority: 20,
          enabled: true
        }
      ]
    },
    {
      id: "route-on-call",
      organizationId: fixedOrganizationId,
      name: "On-call reviewers",
      description: "Modeled external provider route",
      approvalsRequired: 2,
      timeoutSeconds: 600,
      fallbackRouteId: "route-local-terminal",
      enabled: true,
      targets: [
        {
          id: "target-sms-on-call",
          routeId: "route-on-call",
          targetType: "sms",
          integrationId: "integration-twilio",
          integrationName: "SMS sender",
          integrationStatus: "inactive",
          approvalGroupId: "group-release",
          approvalGroupName: "Release on-call",
          currentOnCallUserName: "Maya",
          config: { providerStatus: "modeled", recipientKind: "on_call" },
          priority: 10,
          enabled: true
        }
      ]
    },
    {
      id: "route-local-terminal",
      organizationId: fixedOrganizationId,
      name: "Fallback terminal",
      description: "Local terminal fallback",
      approvalsRequired: 1,
      timeoutSeconds: 300,
      fallbackRouteId: null,
      enabled: true,
      targets: [
        {
          id: "target-local-terminal",
          routeId: "route-local-terminal",
          targetType: "local_terminal",
          integrationId: null,
          integrationName: null,
          integrationStatus: null,
          approvalGroupId: null,
          approvalGroupName: null,
          currentOnCallUserName: null,
          config: { providerStatus: "active", recipientKind: "system" },
          priority: 10,
          enabled: true
        }
      ]
    }
  ];

  return {
    approvalGroups,
    integrations,
    routes,
    selectedRouteId: routes[0].id,
    selectedTargetId: routes[0].targets[0].id
  };
}

export function getSelectedRoute(state: RouteBuilderState): RouteRecord | null {
  return state.routes.find((route) => route.id === state.selectedRouteId) ?? state.routes[0] ?? null;
}

export function updateRouteSettings(state: RouteBuilderState, routeId: string, patch: RouteInput): RouteBuilderState {
  validateRoutePatch(patch);
  if (patch.fallbackRouteId !== undefined) {
    assertFallbackAllowed(state.routes, routeId, patch.fallbackRouteId);
  }

  return {
    ...state,
    routes: state.routes.map((route) =>
      route.id === routeId
        ? {
            ...route,
            approvalsRequired: patch.approvalsRequired ?? route.approvalsRequired,
            description: patch.description !== undefined ? patch.description : route.description,
            enabled: patch.enabled ?? route.enabled,
            fallbackRouteId: patch.fallbackRouteId !== undefined ? patch.fallbackRouteId : route.fallbackRouteId,
            name: patch.name ?? route.name,
            timeoutSeconds: patch.timeoutSeconds ?? route.timeoutSeconds
          }
        : route
    ),
    selectedRouteId: routeId
  };
}

export function setRouteFallback(
  state: RouteBuilderState,
  routeId: string,
  fallbackRouteId: string | null
): RouteBuilderState {
  return updateRouteSettings(state, routeId, { fallbackRouteId });
}

export function addRouteTarget(state: RouteBuilderState, input: RouteTargetInput): RouteBuilderState {
  const route = getSelectedRoute(state);
  if (!route) {
    return state;
  }
  validateTargetInput(input);
  const target = normalizeTargetInput(state, route.id, input);

  return {
    ...state,
    routes: state.routes.map((current) =>
      current.id === route.id ? { ...current, targets: sortTargets([...current.targets, target]) } : current
    ),
    selectedTargetId: target.id
  };
}

export function serializeRouteConfig(state: RouteBuilderState): SerializedRouteConfig {
  return {
    schemaVersion: 1,
    providerMatrix: providerTargetTypes.map((targetType) => ({
      targetType,
      label: labelForTargetType(targetType),
      status: targetType === "web_inbox" || targetType === "local_terminal" ? "active" : "modeled",
      workerStatus: targetType === "web_inbox" ? "ready" : targetType === "local_terminal" ? "local" : "worker pending"
    })),
    routes: state.routes
      .map((route) => ({
        id: route.id,
        name: route.name,
        approvalsRequired: route.approvalsRequired,
        timeoutSeconds: route.timeoutSeconds,
        fallbackRouteId: route.fallbackRouteId,
        enabled: route.enabled,
        targets: sortTargets(route.targets)
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  };
}

export function sortTargets(targets: RouteTargetRecord[]): RouteTargetRecord[] {
  return [...targets].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

export function labelForTargetType(targetType: RouteTargetType): string {
  const labels: Record<RouteTargetType, string> = {
    email: "Email",
    github: "GitHub",
    jira: "Jira",
    linear: "Linear",
    local_terminal: "Local terminal",
    slack: "Slack",
    sms: "SMS",
    web_inbox: "Web inbox",
    webhook: "Webhook"
  };

  return labels[targetType];
}

export function integrationProviderForTarget(targetType: RouteTargetType): IntegrationProvider | null {
  if (targetType === "web_inbox" || targetType === "local_terminal") {
    return null;
  }
  if (targetType === "sms") {
    return "twilio";
  }

  return targetType;
}

function normalizeTargetInput(
  state: RouteBuilderState,
  routeId: string,
  input: RouteTargetInput
): RouteTargetRecord {
  const integration = input.integrationId
    ? state.integrations.find((candidate) => candidate.id === input.integrationId) ?? null
    : null;
  const group = input.approvalGroupId
    ? state.approvalGroups.find((candidate) => candidate.id === input.approvalGroupId) ?? null
    : null;
  const recipientKind = input.config?.recipientKind ?? (input.approvalGroupId ? "group" : "system");

  return {
    id: `target-${input.targetType}-${input.priority}`,
    routeId,
    targetType: input.targetType,
    integrationId: integration?.id ?? null,
    integrationName: integration?.name ?? null,
    integrationStatus: integration?.status ?? null,
    approvalGroupId: group?.id ?? null,
    approvalGroupName: group?.name ?? null,
    currentOnCallUserName: recipientKind === "on_call" ? group?.currentOnCallUserName ?? null : null,
    config: {
      providerStatus: input.config?.providerStatus ?? "modeled",
      recipientKind
    },
    priority: input.priority,
    enabled: input.enabled ?? true
  };
}

function validateRoutePatch(patch: RouteInput) {
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new Error("Route name is required.");
  }
  if (patch.approvalsRequired !== undefined && patch.approvalsRequired < 1) {
    throw new Error("Approvals required must be positive.");
  }
  if (patch.timeoutSeconds !== undefined && patch.timeoutSeconds < 1) {
    throw new Error("Timeout seconds must be positive.");
  }
}

function validateTargetInput(input: RouteTargetInput) {
  if (!providerTargetTypes.includes(input.targetType)) {
    throw new Error("Unsupported route target type.");
  }
  if (input.priority < 1) {
    throw new Error("Target priority must be positive.");
  }
}

function assertFallbackAllowed(routes: RouteRecord[], routeId: string, fallbackRouteId: string | null) {
  if (!fallbackRouteId) {
    return;
  }
  if (routeId === fallbackRouteId) {
    throw new Error("A route cannot fall back to itself.");
  }

  const routeById = new Map(routes.map((route) => [route.id, route]));
  let current: RouteRecord | undefined = routeById.get(fallbackRouteId);
  const visited = new Set<string>();

  while (current?.fallbackRouteId) {
    if (current.fallbackRouteId === routeId) {
      throw new Error("Fallback cycle detected.");
    }
    if (visited.has(current.id)) {
      throw new Error("Fallback cycle detected.");
    }
    visited.add(current.id);
    current = routeById.get(current.fallbackRouteId);
  }
}
