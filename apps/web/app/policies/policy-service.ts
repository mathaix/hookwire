import pg from "pg";
import {
  serializePolicyBundle,
  sortRules,
  type PolicyBundle,
  type PolicyDecision,
  type PolicyDefaultDecision,
  type PolicyMatcher,
  type PolicyOverrideScope,
  type PolicyRecord,
  type PolicyRule,
  type PolicyStatus,
  type RouteOption
} from "./domain";

const { Client } = pg;

export type CreatePolicyInput = {
  databaseRole?: string | null;
  databaseUrl?: string;
  defaultDecision: PolicyDefaultDecision;
  name: string;
  organizationId: string;
  projectId: string;
  status?: PolicyStatus;
  userId: string;
};

export type CreatePolicyRuleInput = {
  databaseRole?: string | null;
  databaseUrl?: string;
  decision: PolicyDecision;
  localOverrideAllowed?: boolean;
  matcher: PolicyMatcher;
  maxScope?: PolicyOverrideScope | null;
  name: string;
  organizationId: string;
  policyId: string;
  priority: number;
  requireOverrideReason?: boolean;
  routeId?: string | null;
  userId: string;
};

export type UpdatePolicyRuleInput = {
  databaseRole?: string | null;
  databaseUrl?: string;
  decision?: PolicyDecision;
  localOverrideAllowed?: boolean;
  matcher?: PolicyMatcher;
  maxScope?: PolicyOverrideScope | null;
  name?: string;
  organizationId: string;
  priority?: number;
  requireOverrideReason?: boolean;
  routeId?: string | null;
  ruleId: string;
  userId: string;
};

export type ReorderPolicyRulesInput = {
  databaseRole?: string | null;
  databaseUrl?: string;
  orderedRuleIds: string[];
  organizationId: string;
  policyId: string;
  userId: string;
};

export type GetPolicyBundleInput = {
  databaseRole?: string | null;
  databaseUrl?: string;
  organizationId: string;
  policyId: string;
};

type PolicyRow = {
  default_decision: PolicyDefaultDecision;
  id: string;
  name: string;
  organization_id: string;
  project_id: string;
  status: PolicyStatus;
  version: number;
};

type RuleRow = {
  decision: PolicyDecision;
  enabled: boolean;
  id: string;
  local_override_allowed: boolean;
  matcher_json: PolicyMatcher;
  max_scope: PolicyOverrideScope | null;
  name: string;
  policy_id: string;
  priority: number;
  require_override_reason: boolean;
  route_id: string | null;
};

type RouteRow = {
  id: string;
  name: string;
};

const editableOrgRoles = new Set(["owner", "admin"]);
const editableProjectRoles = new Set(["owner", "admin", "member"]);

export class PolicyServiceError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PolicyServiceError";
    this.status = status;
    this.code = code;
  }
}

export async function createPolicy(input: CreatePolicyInput): Promise<PolicyRecord> {
  return withTenantClient(input, async (client) => {
    await assertCanEditProject(client, input.organizationId, input.projectId, input.userId);
    const { rows } = await client.query<PolicyRow>(
      `
        insert into policies (organization_id, project_id, name, status, default_decision, created_by_user_id)
        values ($1, $2, $3, $4, $5, $6)
        returning id, organization_id, project_id, name, version, status, default_decision
      `,
      [
        input.organizationId,
        input.projectId,
        input.name.trim(),
        input.status ?? "draft",
        input.defaultDecision,
        input.userId
      ]
    );

    return { ...mapPolicyRow(rows[0]), rules: [] };
  });
}

export async function createPolicyRule(input: CreatePolicyRuleInput): Promise<PolicyRule> {
  return withTenantClient(input, async (client) => {
    const policy = await getPolicyForEdit(client, input.organizationId, input.policyId, input.userId);
    const localOverrideAllowed = Boolean(input.localOverrideAllowed);
    const requireOverrideReason = localOverrideAllowed && Boolean(input.requireOverrideReason);
    const maxScope = localOverrideAllowed ? input.maxScope ?? null : null;
    validateRuleInput({ ...input, maxScope });
    const routeId = input.decision === "route" ? input.routeId ?? null : null;
    await assertPriorityAvailable(client, input.organizationId, input.policyId, input.priority);

    try {
      const { rows } = await client.query<RuleRow>(
        `
          insert into policy_rules (
            organization_id, policy_id, name, priority, matcher_json, decision, route_id,
            local_override_allowed, require_override_reason, max_scope
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          returning id, policy_id, name, priority, matcher_json, decision, route_id, local_override_allowed,
            require_override_reason, max_scope, enabled
        `,
        [
          input.organizationId,
          input.policyId,
          input.name.trim(),
          input.priority,
          JSON.stringify(compactMatcher(input.matcher)),
          input.decision,
          routeId,
          localOverrideAllowed,
          requireOverrideReason,
          maxScope
        ]
      );
      await bumpPolicyVersion(client, input.organizationId, policy.id);

      return mapRuleRow(rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PolicyServiceError(409, "priority_conflict", "Rule priority already exists for this policy.");
      }
      throw error;
    }
  });
}

export async function updatePolicyRuleRecord(input: UpdatePolicyRuleInput): Promise<PolicyRule> {
  return withTenantClient(input, async (client) => {
    const current = await getRuleForEdit(client, input.organizationId, input.ruleId, input.userId);
    const nextDecision = input.decision ?? current.decision;
    const nextRouteId = nextDecision === "route" ? (input.routeId !== undefined ? input.routeId : current.routeId) : null;
    const nextLocalOverrideAllowed = input.localOverrideAllowed ?? current.localOverrideAllowed;
    const nextRequireOverrideReason = nextLocalOverrideAllowed
      ? input.requireOverrideReason ?? current.requireOverrideReason
      : false;
    const nextMaxScope = nextLocalOverrideAllowed ? (input.maxScope !== undefined ? input.maxScope : current.maxScope) : null;
    const nextMatcher = input.matcher ?? current.matcher;
    validateRuleInput({
      decision: nextDecision,
      matcher: nextMatcher,
      maxScope: nextMaxScope,
      name: input.name ?? current.name,
      organizationId: input.organizationId,
      policyId: current.policyId,
      priority: input.priority ?? current.priority,
      routeId: nextRouteId,
      userId: input.userId
    });

    try {
      const { rows } = await client.query<RuleRow>(
        `
          update policy_rules
          set
            name = $1,
            priority = $2,
            matcher_json = $3,
            decision = $4,
            route_id = $5,
            local_override_allowed = $6,
            require_override_reason = $7,
            max_scope = $8,
            updated_at = now()
          where organization_id = $9 and id = $10
          returning id, policy_id, name, priority, matcher_json, decision, route_id, local_override_allowed,
            require_override_reason, max_scope, enabled
        `,
        [
          input.name?.trim() ?? current.name,
          input.priority ?? current.priority,
          JSON.stringify(compactMatcher(nextMatcher)),
          nextDecision,
          nextRouteId,
          nextLocalOverrideAllowed,
          nextRequireOverrideReason,
          nextMaxScope,
          input.organizationId,
          input.ruleId
        ]
      );
      await bumpPolicyVersion(client, input.organizationId, current.policyId);

      return mapRuleRow(rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PolicyServiceError(409, "priority_conflict", "Rule priority already exists for this policy.");
      }
      throw error;
    }
  });
}

export async function reorderPolicyRules(input: ReorderPolicyRulesInput): Promise<PolicyRule[]> {
  return withTenantClient(input, async (client) => {
    await getPolicyForEdit(client, input.organizationId, input.policyId, input.userId);
    const currentRules = await listRules(client, input.organizationId, input.policyId);
    const currentIds = currentRules.map((rule) => rule.id).sort();
    const requestedIds = [...input.orderedRuleIds].sort();
    if (JSON.stringify(currentIds) !== JSON.stringify(requestedIds)) {
      throw new PolicyServiceError(400, "invalid_rule_order", "Rule order must include every rule exactly once.");
    }

    for (let index = 0; index < input.orderedRuleIds.length; index += 1) {
      await client.query(
        "update policy_rules set priority = $1, updated_at = now() where organization_id = $2 and id = $3",
        [-(index + 1), input.organizationId, input.orderedRuleIds[index]]
      );
    }
    for (let index = 0; index < input.orderedRuleIds.length; index += 1) {
      await client.query(
        "update policy_rules set priority = $1, updated_at = now() where organization_id = $2 and id = $3",
        [(index + 1) * 10, input.organizationId, input.orderedRuleIds[index]]
      );
    }
    await bumpPolicyVersion(client, input.organizationId, input.policyId);

    return listRules(client, input.organizationId, input.policyId);
  });
}

export async function getPolicyBundle(input: GetPolicyBundleInput): Promise<PolicyBundle> {
  return withTenantClient(input, async (client) => {
    const policy = await getPolicy(client, input.organizationId, input.policyId);
    const rules = await listRules(client, input.organizationId, input.policyId);
    const routes = await listRoutes(client, input.organizationId);

    return serializePolicyBundle({ ...policy, rules }, routes);
  });
}

async function withTenantClient<T>(
  input: { databaseRole?: string | null; databaseUrl?: string; organizationId: string },
  callback: (client: InstanceType<typeof Client>) => Promise<T>
) {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new PolicyServiceError(500, "database_not_configured", "DATABASE_URL is required.");
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

async function getPolicyForEdit(
  client: InstanceType<typeof Client>,
  organizationId: string,
  policyId: string,
  userId: string
): Promise<PolicyRecord> {
  const policy = await getPolicy(client, organizationId, policyId);
  await assertCanEditProject(client, organizationId, policy.projectId, userId);

  return policy;
}

async function getRuleForEdit(
  client: InstanceType<typeof Client>,
  organizationId: string,
  ruleId: string,
  userId: string
): Promise<PolicyRule> {
  const { rows } = await client.query<RuleRow>(
    `
      select id, policy_id, name, priority, matcher_json, decision, route_id, local_override_allowed,
        require_override_reason, max_scope, enabled
      from policy_rules
      where organization_id = $1 and id = $2
    `,
    [organizationId, ruleId]
  );
  const rule = rows[0] ? mapRuleRow(rows[0]) : null;
  if (!rule) {
    throw new PolicyServiceError(404, "rule_not_found", "Policy rule was not found.");
  }

  await getPolicyForEdit(client, organizationId, rule.policyId, userId);

  return rule;
}

async function getPolicy(
  client: InstanceType<typeof Client>,
  organizationId: string,
  policyId: string
): Promise<PolicyRecord> {
  const { rows } = await client.query<PolicyRow>(
    `
      select id, organization_id, project_id, name, version, status, default_decision
      from policies
      where organization_id = $1 and id = $2
    `,
    [organizationId, policyId]
  );
  if (!rows[0]) {
    throw new PolicyServiceError(404, "policy_not_found", "Policy was not found.");
  }

  return { ...mapPolicyRow(rows[0]), rules: [] };
}

async function listRules(
  client: InstanceType<typeof Client>,
  organizationId: string,
  policyId: string
): Promise<PolicyRule[]> {
  const { rows } = await client.query<RuleRow>(
    `
      select id, policy_id, name, priority, matcher_json, decision, route_id, local_override_allowed,
        require_override_reason, max_scope, enabled
      from policy_rules
      where organization_id = $1 and policy_id = $2
      order by priority, id
    `,
    [organizationId, policyId]
  );

  return sortRules(rows.map(mapRuleRow));
}

async function listRoutes(client: InstanceType<typeof Client>, organizationId: string): Promise<RouteOption[]> {
  const { rows } = await client.query<RouteRow>(
    "select id, name from routes where organization_id = $1 order by name",
    [organizationId]
  );

  return rows.map((row) => ({ id: row.id, name: row.name }));
}

async function assertPriorityAvailable(
  client: InstanceType<typeof Client>,
  organizationId: string,
  policyId: string,
  priority: number
) {
  const { rows } = await client.query<{ id: string }>(
    "select id from policy_rules where organization_id = $1 and policy_id = $2 and priority = $3",
    [organizationId, policyId, priority]
  );
  if (rows[0]) {
    throw new PolicyServiceError(409, "priority_conflict", "Rule priority already exists for this policy.");
  }
}

async function assertCanEditProject(
  client: InstanceType<typeof Client>,
  organizationId: string,
  projectId: string,
  userId: string
) {
  const { rows } = await client.query<{ organization_role: string | null; project_role: string | null }>(
    `
      select m.role as organization_role, pm.role as project_role
      from memberships m
      left join project_memberships pm
        on pm.organization_id = m.organization_id
        and pm.user_id = m.user_id
        and pm.project_id = $2
        and pm.status = 'active'
      where m.organization_id = $1 and m.user_id = $3 and m.status = 'active'
    `,
    [organizationId, projectId, userId]
  );
  const row = rows[0];
  if (!row || (!editableOrgRoles.has(row.organization_role ?? "") && !editableProjectRoles.has(row.project_role ?? ""))) {
    throw new PolicyServiceError(403, "unauthorized", "User is not eligible to edit this policy.");
  }
}

async function bumpPolicyVersion(client: InstanceType<typeof Client>, organizationId: string, policyId: string) {
  await client.query("update policies set version = version + 1, updated_at = now() where organization_id = $1 and id = $2", [
    organizationId,
    policyId
  ]);
}

function validateRuleInput(input: {
  decision: PolicyDecision;
  matcher: PolicyMatcher;
  maxScope?: PolicyOverrideScope | null;
  name: string;
  organizationId: string;
  policyId: string;
  priority: number;
  routeId?: string | null;
  userId: string;
}) {
  if (!input.name.trim()) {
    throw new PolicyServiceError(400, "name_required", "Policy rule name is required.");
  }

  if (input.priority <= 0) {
    throw new PolicyServiceError(400, "invalid_priority", "Policy rule priority must be positive.");
  }

  if (input.decision === "route" && !input.routeId) {
    throw new PolicyServiceError(400, "route_required", "Route decisions require a route.");
  }

  if (Object.keys(compactMatcher(input.matcher)).length === 0) {
    throw new PolicyServiceError(400, "matcher_required", "At least one matcher is required.");
  }

  if (input.maxScope && !isOverrideScope(input.maxScope)) {
    throw new PolicyServiceError(400, "invalid_scope", "Override scope is invalid.");
  }
}

function mapPolicyRow(row: PolicyRow): Omit<PolicyRecord, "rules"> {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    name: row.name,
    version: Number(row.version),
    status: row.status,
    defaultDecision: row.default_decision
  };
}

function mapRuleRow(row: RuleRow): PolicyRule {
  return {
    id: row.id,
    policyId: row.policy_id,
    name: row.name,
    priority: Number(row.priority),
    matcher: compactMatcher(row.matcher_json ?? {}),
    decision: row.decision,
    routeId: row.route_id,
    localOverrideAllowed: row.local_override_allowed,
    requireOverrideReason: row.require_override_reason,
    maxScope: row.max_scope,
    enabled: row.enabled
  };
}

function compactMatcher(matcher: PolicyMatcher): PolicyMatcher {
  return Object.fromEntries(
    Object.entries(matcher)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
      .filter(([, value]) => value !== undefined && value !== "")
  ) as PolicyMatcher;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new PolicyServiceError(500, "invalid_database_role", "Configured database role is invalid.");
  }

  return `"${identifier.replaceAll('"', '""')}"`;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function isOverrideScope(value: string): value is PolicyOverrideScope {
  return value === "once" || value === "session" || value === "project";
}
