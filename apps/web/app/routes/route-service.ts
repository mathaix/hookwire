import pg from "pg";
import {
  integrationProviderForTarget,
  providerTargetTypes,
  sortTargets,
  type ApprovalGroupOption,
  type IntegrationOption,
  type IntegrationProvider,
  type IntegrationStatus,
  type RecipientKind,
  type RouteBuilderState,
  type RouteRecord,
  type RouteTargetConfig,
  type RouteTargetRecord,
  type RouteTargetType
} from "./domain";

const { Client } = pg;

export type RouteServiceInput = {
  databaseRole?: string | null;
  databaseUrl?: string;
  organizationId: string;
};

export type CreateRouteInput = RouteServiceInput & {
  approvalsRequired?: number;
  description?: string | null;
  fallbackRouteId?: string | null;
  name: string;
  timeoutSeconds?: number;
  userId: string;
};

export type UpdateRouteInput = RouteServiceInput & {
  approvalsRequired?: number;
  description?: string | null;
  enabled?: boolean;
  fallbackRouteId?: string | null;
  name?: string;
  routeId: string;
  timeoutSeconds?: number;
  userId: string;
};

export type CreateRouteTargetInput = RouteServiceInput & {
  approvalGroupId?: string | null;
  config?: RouteTargetConfig;
  enabled?: boolean;
  integrationId?: string | null;
  priority: number;
  routeId: string;
  targetType: RouteTargetType;
  userId: string;
};

export type RouteMutationInput = RouteServiceInput & {
  routeId: string;
  userId: string;
};

type RouteRow = {
  approvals_required: number;
  description: string | null;
  enabled: boolean;
  fallback_route_id: string | null;
  id: string;
  name: string;
  organization_id: string;
  timeout_seconds: number;
};

type TargetRow = {
  approval_group_id: string | null;
  approval_group_name: string | null;
  config_json: RouteTargetConfig;
  current_on_call_user_name: string | null;
  enabled: boolean;
  id: string;
  integration_id: string | null;
  integration_name: string | null;
  integration_status: IntegrationStatus | null;
  priority: number;
  route_id: string;
  target_type: RouteTargetType;
};

type IntegrationRow = {
  id: string;
  name: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
};

type GroupRow = {
  current_on_call_user_name: string | null;
  id: string;
  name: string;
};

const editableOrgRoles = new Set(["owner", "admin"]);

export class RouteServiceError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RouteServiceError";
    this.status = status;
    this.code = code;
  }
}

export async function createRoute(input: CreateRouteInput): Promise<RouteRecord> {
  return withTenantClient(input, async (client) => {
    await assertCanEditOrganization(client, input.organizationId, input.userId);
    validateRouteInput(input);
    if (input.fallbackRouteId) {
      await assertFallbackAllowed(client, input.organizationId, "new-route", input.fallbackRouteId);
    }

    try {
      const { rows } = await client.query<RouteRow>(
        `
          insert into routes (organization_id, name, description, approvals_required, timeout_seconds, fallback_route_id)
          values ($1, $2, $3, $4, $5, $6)
          returning id, organization_id, name, description, approvals_required, timeout_seconds, fallback_route_id, enabled
        `,
        [
          input.organizationId,
          input.name.trim(),
          input.description ?? null,
          input.approvalsRequired ?? 1,
          input.timeoutSeconds ?? 900,
          input.fallbackRouteId ?? null
        ]
      );

      return { ...mapRouteRow(rows[0]), targets: [] };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new RouteServiceError(409, "route_name_conflict", "Route name already exists.");
      }
      throw error;
    }
  });
}

export async function updateRoute(input: UpdateRouteInput): Promise<RouteRecord> {
  return withTenantClient(input, async (client) => {
    await assertCanEditOrganization(client, input.organizationId, input.userId);
    validateRouteInput(input);
    const currentRoute = await getRoute(client, input.organizationId, input.routeId);
    if (input.fallbackRouteId !== undefined) {
      await assertFallbackAllowed(client, input.organizationId, input.routeId, input.fallbackRouteId);
    }

    try {
      const { rows } = await client.query<RouteRow>(
        `
          update routes
          set
            name = coalesce($1, name),
            description = $2,
            approvals_required = coalesce($3, approvals_required),
            timeout_seconds = coalesce($4, timeout_seconds),
            fallback_route_id = $5,
            enabled = coalesce($6, enabled),
            updated_at = now()
          where organization_id = $7 and id = $8
          returning id, organization_id, name, description, approvals_required, timeout_seconds, fallback_route_id, enabled
        `,
        [
          input.name?.trim() || null,
          input.description !== undefined ? input.description : currentRoute.description,
          input.approvalsRequired ?? null,
          input.timeoutSeconds ?? null,
          input.fallbackRouteId !== undefined ? input.fallbackRouteId : currentRoute.fallbackRouteId,
          input.enabled ?? null,
          input.organizationId,
          input.routeId
        ]
      );

      return { ...mapRouteRow(rows[0]), targets: await listTargets(client, input.organizationId, input.routeId) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new RouteServiceError(409, "route_name_conflict", "Route name already exists.");
      }
      throw error;
    }
  });
}

export async function createRouteTarget(input: CreateRouteTargetInput): Promise<RouteTargetRecord> {
  return withTenantClient(input, async (client) => {
    await assertCanEditOrganization(client, input.organizationId, input.userId);
    await getRoute(client, input.organizationId, input.routeId);
    const target = await normalizeTargetInput(client, input);
    await assertTargetPriorityAvailable(client, input.organizationId, input.routeId, input.priority);

    try {
      const { rows } = await client.query<TargetRow>(
        `
          insert into route_targets (
            organization_id, route_id, target_type, integration_id, approval_group_id,
            config_json, priority, enabled
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8)
          returning id, route_id, target_type, integration_id, approval_group_id, config_json,
            priority, enabled, null::text as integration_name, null::text as integration_status,
            null::text as approval_group_name, null::text as current_on_call_user_name
        `,
        [
          input.organizationId,
          input.routeId,
          target.targetType,
          target.integrationId,
          target.approvalGroupId,
          JSON.stringify(target.config),
          target.priority,
          target.enabled
        ]
      );

      return (await hydrateTargets(client, input.organizationId, [rows[0]])).at(0)!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new RouteServiceError(409, "target_priority_conflict", "Target priority already exists for this route.");
      }
      throw error;
    }
  });
}

export async function listRouteConfig(input: RouteServiceInput): Promise<RouteBuilderState> {
  return withTenantClient(input, async (client) => {
    const routes = await listRoutes(client, input.organizationId);
    const approvalGroups = await listApprovalGroups(client, input.organizationId);
    const integrations = await listIntegrations(client, input.organizationId);

    return {
      approvalGroups,
      integrations,
      routes,
      selectedRouteId: routes[0]?.id ?? null,
      selectedTargetId: routes[0]?.targets[0]?.id ?? null
    };
  });
}

export async function disableRoute(input: RouteMutationInput): Promise<RouteRecord> {
  return withTenantClient(input, async (client) => {
    await assertCanEditOrganization(client, input.organizationId, input.userId);
    await assertRouteNotReferenced(client, input.organizationId, input.routeId);
    const { rows } = await client.query<RouteRow>(
      `
        update routes
        set enabled = false, updated_at = now()
        where organization_id = $1 and id = $2
        returning id, organization_id, name, description, approvals_required, timeout_seconds, fallback_route_id, enabled
      `,
      [input.organizationId, input.routeId]
    );
    if (!rows[0]) {
      throw new RouteServiceError(404, "route_not_found", "Route was not found.");
    }

    return { ...mapRouteRow(rows[0]), targets: await listTargets(client, input.organizationId, input.routeId) };
  });
}

export async function deleteRoute(input: RouteMutationInput): Promise<{ deleted: true; routeId: string }> {
  return withTenantClient(input, async (client) => {
    await assertCanEditOrganization(client, input.organizationId, input.userId);
    await assertRouteNotReferenced(client, input.organizationId, input.routeId);
    const { rowCount } = await client.query("delete from routes where organization_id = $1 and id = $2", [
      input.organizationId,
      input.routeId
    ]);
    if (rowCount === 0) {
      throw new RouteServiceError(404, "route_not_found", "Route was not found.");
    }

    return { deleted: true, routeId: input.routeId };
  });
}

async function withTenantClient<T>(
  input: { databaseRole?: string | null; databaseUrl?: string; organizationId: string },
  callback: (client: InstanceType<typeof Client>) => Promise<T>
) {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new RouteServiceError(500, "database_not_configured", "DATABASE_URL is required.");
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

async function listRoutes(client: InstanceType<typeof Client>, organizationId: string): Promise<RouteRecord[]> {
  const { rows } = await client.query<RouteRow>(
    `
      select id, organization_id, name, description, approvals_required, timeout_seconds, fallback_route_id, enabled
      from routes
      where organization_id = $1
      order by name
    `,
    [organizationId]
  );
  const targetRows = await listTargets(client, organizationId);
  const targetsByRoute = new Map<string, RouteTargetRecord[]>();
  for (const target of targetRows) {
    const targets = targetsByRoute.get(target.routeId) ?? [];
    targets.push(target);
    targetsByRoute.set(target.routeId, targets);
  }

  return rows.map((row) => ({
    ...mapRouteRow(row),
    targets: sortTargets(targetsByRoute.get(row.id) ?? [])
  }));
}

async function getRoute(client: InstanceType<typeof Client>, organizationId: string, routeId: string): Promise<RouteRecord> {
  const { rows } = await client.query<RouteRow>(
    `
      select id, organization_id, name, description, approvals_required, timeout_seconds, fallback_route_id, enabled
      from routes
      where organization_id = $1 and id = $2
    `,
    [organizationId, routeId]
  );
  if (!rows[0]) {
    throw new RouteServiceError(404, "route_not_found", "Route was not found.");
  }

  return { ...mapRouteRow(rows[0]), targets: await listTargets(client, organizationId, routeId) };
}

async function listTargets(
  client: InstanceType<typeof Client>,
  organizationId: string,
  routeId?: string
): Promise<RouteTargetRecord[]> {
  const { rows } = await client.query<TargetRow>(
    `
      select
        rt.id,
        rt.route_id,
        rt.target_type,
        rt.integration_id,
        rt.approval_group_id,
        rt.config_json,
        rt.priority,
        rt.enabled,
        i.name as integration_name,
        i.status as integration_status,
        ag.name as approval_group_name,
        on_call_user.name as current_on_call_user_name
      from route_targets rt
      left join integrations i on i.organization_id = rt.organization_id and i.id = rt.integration_id
      left join approval_groups ag on ag.organization_id = rt.organization_id and ag.id = rt.approval_group_id
      left join lateral (
        select users.name
        from on_call_assignments assignments
        join users on users.id = assignments.user_id
        where assignments.organization_id = rt.organization_id
          and assignments.approval_group_id = rt.approval_group_id
          and assignments.starts_at <= now()
          and (assignments.ends_at is null or assignments.ends_at > now())
        order by assignments.starts_at desc
        limit 1
      ) on_call_user on true
      where rt.organization_id = $1 and ($2::uuid is null or rt.route_id = $2)
      order by rt.priority, rt.id
    `,
    [organizationId, routeId ?? null]
  );

  return hydrateTargets(client, organizationId, rows);
}

async function hydrateTargets(
  _client: InstanceType<typeof Client>,
  _organizationId: string,
  rows: TargetRow[]
): Promise<RouteTargetRecord[]> {
  return sortTargets(rows.map(mapTargetRow));
}

async function listApprovalGroups(
  client: InstanceType<typeof Client>,
  organizationId: string
): Promise<ApprovalGroupOption[]> {
  const { rows } = await client.query<GroupRow>(
    `
      select
        ag.id,
        ag.name,
        on_call_user.name as current_on_call_user_name
      from approval_groups ag
      left join lateral (
        select users.name
        from on_call_assignments assignments
        join users on users.id = assignments.user_id
        where assignments.organization_id = ag.organization_id
          and assignments.approval_group_id = ag.id
          and assignments.starts_at <= now()
          and (assignments.ends_at is null or assignments.ends_at > now())
        order by assignments.starts_at desc
        limit 1
      ) on_call_user on true
      where ag.organization_id = $1
      order by ag.name
    `,
    [organizationId]
  );

  return rows.map((row) => ({
    currentOnCallUserName: row.current_on_call_user_name,
    id: row.id,
    name: row.name
  }));
}

async function listIntegrations(
  client: InstanceType<typeof Client>,
  organizationId: string
): Promise<IntegrationOption[]> {
  const { rows } = await client.query<IntegrationRow>(
    "select id, provider, name, status from integrations where organization_id = $1 order by provider, name",
    [organizationId]
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    provider: row.provider,
    status: row.status
  }));
}

async function normalizeTargetInput(
  client: InstanceType<typeof Client>,
  input: CreateRouteTargetInput
): Promise<{
  approvalGroupId: string | null;
  config: RouteTargetConfig;
  enabled: boolean;
  integrationId: string | null;
  priority: number;
  targetType: RouteTargetType;
}> {
  validateTargetInput(input);
  const recipientKind = input.config?.recipientKind ?? (input.approvalGroupId ? "group" : "system");
  if ((recipientKind === "group" || recipientKind === "on_call") && !input.approvalGroupId) {
    throw new RouteServiceError(400, "approval_group_required", "Group and on-call targets require an approval group.");
  }
  if (input.approvalGroupId) {
    await getApprovalGroup(client, input.organizationId, input.approvalGroupId);
  }

  const requiredProvider = integrationProviderForTarget(input.targetType);
  let integrationId: string | null = null;
  if (requiredProvider) {
    if (!input.integrationId) {
      throw new RouteServiceError(400, "integration_required", "External provider targets require an integration.");
    }
    const integration = await getIntegration(client, input.organizationId, input.integrationId);
    if (integration.provider !== requiredProvider) {
      throw new RouteServiceError(400, "integration_provider_mismatch", "Integration provider does not match target type.");
    }
    integrationId = integration.id;
  }

  return {
    approvalGroupId: input.approvalGroupId ?? null,
    config: {
      ...input.config,
      providerStatus: input.config?.providerStatus ?? (input.targetType === "web_inbox" ? "active" : "modeled"),
      recipientKind
    },
    enabled: input.enabled ?? true,
    integrationId,
    priority: input.priority,
    targetType: input.targetType
  };
}

async function getApprovalGroup(client: InstanceType<typeof Client>, organizationId: string, groupId: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from approval_groups where organization_id = $1 and id = $2",
    [organizationId, groupId]
  );
  if (!rows[0]) {
    throw new RouteServiceError(400, "approval_group_not_found", "Approval group was not found.");
  }
}

async function getIntegration(
  client: InstanceType<typeof Client>,
  organizationId: string,
  integrationId: string
): Promise<IntegrationRow> {
  const { rows } = await client.query<IntegrationRow>(
    "select id, provider, name, status from integrations where organization_id = $1 and id = $2",
    [organizationId, integrationId]
  );
  if (!rows[0]) {
    throw new RouteServiceError(400, "integration_not_found", "Integration was not found.");
  }

  return rows[0];
}

async function assertTargetPriorityAvailable(
  client: InstanceType<typeof Client>,
  organizationId: string,
  routeId: string,
  priority: number
) {
  const { rows } = await client.query<{ id: string }>(
    "select id from route_targets where organization_id = $1 and route_id = $2 and priority = $3",
    [organizationId, routeId, priority]
  );
  if (rows[0]) {
    throw new RouteServiceError(409, "target_priority_conflict", "Target priority already exists for this route.");
  }
}

async function assertFallbackAllowed(
  client: InstanceType<typeof Client>,
  organizationId: string,
  routeId: string,
  fallbackRouteId: string | null
) {
  if (!fallbackRouteId) {
    return;
  }
  if (routeId === fallbackRouteId) {
    throw new RouteServiceError(400, "fallback_self", "A route cannot fall back to itself.");
  }

  const { rows } = await client.query<{ id: string; fallback_route_id: string | null }>(
    "select id, fallback_route_id from routes where organization_id = $1",
    [organizationId]
  );
  if (!rows.some((row) => row.id === fallbackRouteId)) {
    throw new RouteServiceError(400, "fallback_not_found", "Fallback route was not found.");
  }

  const fallbackByRoute = new Map(rows.map((row) => [row.id, row.fallback_route_id]));
  fallbackByRoute.set(routeId, fallbackRouteId);
  let current: string | null = fallbackRouteId;
  const visited = new Set<string>();

  while (current) {
    if (current === routeId) {
      throw new RouteServiceError(400, "fallback_cycle", "Fallback cycle detected.");
    }
    if (visited.has(current)) {
      throw new RouteServiceError(400, "fallback_cycle", "Fallback cycle detected.");
    }
    visited.add(current);
    current = fallbackByRoute.get(current) ?? null;
  }
}

async function assertRouteNotReferenced(client: InstanceType<typeof Client>, organizationId: string, routeId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      select id from policy_rules where organization_id = $1 and route_id = $2
      union all
      select id from routes where organization_id = $1 and fallback_route_id = $2
      limit 1
    `,
    [organizationId, routeId]
  );
  if (rows[0]) {
    throw new RouteServiceError(409, "route_in_use", "Route is referenced by a policy rule.");
  }
}

async function assertCanEditOrganization(
  client: InstanceType<typeof Client>,
  organizationId: string,
  userId: string
) {
  const { rows } = await client.query<{ role: string | null }>(
    "select role from memberships where organization_id = $1 and user_id = $2 and status = 'active'",
    [organizationId, userId]
  );
  if (!rows[0] || !editableOrgRoles.has(rows[0].role ?? "")) {
    throw new RouteServiceError(403, "unauthorized", "User is not eligible to edit routes.");
  }
}

function validateRouteInput(input: { approvalsRequired?: number; name?: string; timeoutSeconds?: number }) {
  if (input.name !== undefined && !input.name.trim()) {
    throw new RouteServiceError(400, "name_required", "Route name is required.");
  }
  if (input.approvalsRequired !== undefined && input.approvalsRequired < 1) {
    throw new RouteServiceError(400, "invalid_approvals_required", "Approvals required must be positive.");
  }
  if (input.timeoutSeconds !== undefined && input.timeoutSeconds < 1) {
    throw new RouteServiceError(400, "invalid_timeout", "Timeout seconds must be positive.");
  }
}

function validateTargetInput(input: CreateRouteTargetInput) {
  if (!providerTargetTypes.includes(input.targetType)) {
    throw new RouteServiceError(400, "invalid_target_type", "Route target type is not supported.");
  }
  if (input.priority < 1) {
    throw new RouteServiceError(400, "invalid_priority", "Target priority must be positive.");
  }
  const recipientKind = input.config?.recipientKind;
  if (recipientKind && recipientKind !== "group" && recipientKind !== "on_call" && recipientKind !== "system") {
    throw new RouteServiceError(400, "invalid_recipient_kind", "Recipient kind is not supported.");
  }
}

function mapRouteRow(row: RouteRow): Omit<RouteRecord, "targets"> {
  return {
    approvalsRequired: Number(row.approvals_required),
    description: row.description,
    enabled: row.enabled,
    fallbackRouteId: row.fallback_route_id,
    id: row.id,
    name: row.name,
    organizationId: row.organization_id,
    timeoutSeconds: Number(row.timeout_seconds)
  };
}

function mapTargetRow(row: TargetRow): RouteTargetRecord {
  const config = row.config_json ?? {};
  const recipientKind = config.recipientKind as RecipientKind | undefined;

  return {
    approvalGroupId: row.approval_group_id,
    approvalGroupName: row.approval_group_name,
    config,
    currentOnCallUserName: recipientKind === "on_call" ? row.current_on_call_user_name : null,
    enabled: row.enabled,
    id: row.id,
    integrationId: row.integration_id,
    integrationName: row.integration_name,
    integrationStatus: row.integration_status,
    priority: Number(row.priority),
    routeId: row.route_id,
    targetType: row.target_type
  };
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new RouteServiceError(500, "invalid_database_role", "Configured database role is invalid.");
  }

  return `"${identifier.replaceAll('"', '""')}"`;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
