import pg from "pg";

const { Client } = pg;

export type ApprovalDecision = "approved" | "denied";
export type ApprovalDecisionScope = "once" | "session" | "project" | "policy_rule";

export type RecordApprovalDecisionInput = {
  approvalRequestId: string;
  databaseRole?: string | null;
  databaseUrl?: string;
  decision: ApprovalDecision;
  organizationId: string;
  reason?: string | null;
  scope?: string | null;
  testHooks?: {
    failBeforeAuditInsert?: boolean;
  };
  userId: string;
};

export type RecordApprovalDecisionResult = {
  approvalRequestId: string;
  auditEventId: string;
  decision: ApprovalDecision;
  decisionId: string;
  reason: string | null;
  scope: ApprovalDecisionScope;
  status: ApprovalDecision;
  userId: string;
};

type ApprovalRequestRow = {
  expires_at: Date | string | null;
  id: string;
  is_expired: boolean;
  organization_id: string;
  project_id: string;
  risk_level: string;
  route_id: string;
  status: string;
};

type DecisionRow = {
  created_at: Date | string;
  id: string;
};

type AuditEventRow = {
  id: string;
};

const allowedScopes = new Set<ApprovalDecisionScope>(["once", "session", "project", "policy_rule"]);
const eligibleRoles = new Set(["owner", "admin", "member"]);

export class ApprovalDecisionError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApprovalDecisionError";
    this.status = status;
    this.code = code;
  }
}

export async function recordApprovalDecision(
  input: RecordApprovalDecisionInput
): Promise<RecordApprovalDecisionResult> {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new ApprovalDecisionError(500, "database_not_configured", "DATABASE_URL is required.");
  }

  const scope = normalizeScope(input.scope);
  const reason = input.reason?.trim() || null;
  validateDecisionInput(input.decision, scope, reason);
  const databaseRole = input.databaseRole ?? process.env.HOOKWIRE_DATABASE_ROLE ?? null;

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  let committed = false;
  try {
    await client.query("begin");
    if (databaseRole) {
      await client.query(`set local role ${quoteIdentifier(databaseRole)}`);
    }
    await client.query("select set_config('app.current_organization_id', $1, true)", [input.organizationId]);

    await assertEligibleReviewer(client, input.organizationId, input.userId);
    const approval = await lockApprovalRequest(client, input.approvalRequestId, input.organizationId);

    if (approval.status === "pending" && approval.is_expired) {
      await client.query(
        "update approval_requests set status = 'expired', updated_at = now() where organization_id = $1 and id = $2",
        [input.organizationId, input.approvalRequestId]
      );
      await client.query("commit");
      committed = true;
      throw new ApprovalDecisionError(409, "expired", "Approval request is expired.");
    }

    if (approval.status !== "pending") {
      throw new ApprovalDecisionError(
        409,
        approval.status === "expired" ? "expired" : "already_decided",
        `Approval request is ${approval.status}.`
      );
    }

    if (input.decision === "denied" && !reason) {
      throw new ApprovalDecisionError(400, "reason_required", "A denial reason is required.");
    }

    await client.query(
      "update approval_requests set status = $1, updated_at = now() where organization_id = $2 and id = $3",
      [input.decision, input.organizationId, input.approvalRequestId]
    );
    const { rows: decisionRows } = await client.query<DecisionRow>(
      `
        insert into approval_decisions (
          approval_request_id, organization_id, user_id, source, decision, scope, reason
        )
        values ($1, $2, $3, 'web', $4, $5, $6)
        returning id, created_at
      `,
      [input.approvalRequestId, input.organizationId, input.userId, input.decision, scope, reason]
    );
    const decisionRow = decisionRows[0];

    if (input.testHooks?.failBeforeAuditInsert) {
      throw new Error("Injected failure before audit insert");
    }

    const metadata = {
      actorUserId: input.userId,
      approvalRequestId: input.approvalRequestId,
      decision: input.decision,
      decisionId: decisionRow.id,
      reason,
      riskLevel: approval.risk_level,
      routeId: approval.route_id,
      scope,
      source: "web"
    };
    const { rows: auditRows } = await client.query<AuditEventRow>(
      `
        insert into audit_events (
          organization_id, project_id, actor_type, actor_user_id, event_type, entity_type, entity_id, metadata_json
        )
        values ($1, $2, 'user', $3, $4, 'approval_request', $5, $6)
        returning id
      `,
      [
        input.organizationId,
        approval.project_id,
        input.userId,
        `approval.${input.decision}`,
        input.approvalRequestId,
        JSON.stringify(metadata)
      ]
    );

    await client.query("commit");
    committed = true;

    return {
      approvalRequestId: input.approvalRequestId,
      auditEventId: auditRows[0].id,
      decision: input.decision,
      decisionId: decisionRow.id,
      reason,
      scope,
      status: input.decision,
      userId: input.userId
    };
  } catch (error) {
    if (!committed) {
      await client.query("rollback").catch(() => {});
    }
    throw error;
  } finally {
    await client.end();
  }
}

function normalizeScope(scope: string | null | undefined): ApprovalDecisionScope {
  return (scope ?? "once") as ApprovalDecisionScope;
}

function validateDecisionInput(decision: ApprovalDecision, scope: ApprovalDecisionScope, reason: string | null) {
  if (decision !== "approved" && decision !== "denied") {
    throw new ApprovalDecisionError(400, "invalid_decision", "Decision must be approved or denied.");
  }

  if (!allowedScopes.has(scope)) {
    throw new ApprovalDecisionError(400, "invalid_scope", "Decision scope is not allowed.");
  }
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new ApprovalDecisionError(500, "invalid_database_role", "Configured database role is invalid.");
  }

  return `"${identifier.replaceAll('"', '""')}"`;
}

async function lockApprovalRequest(
  client: InstanceType<typeof Client>,
  approvalRequestId: string,
  organizationId: string
): Promise<ApprovalRequestRow> {
  const { rows } = await client.query<ApprovalRequestRow>(
    `
      select
        id,
        organization_id,
        project_id,
        status,
        expires_at,
        expires_at is not null and expires_at <= now() as is_expired,
        route_id,
        risk_level
      from approval_requests
      where id = $1 and organization_id = $2
      for update
    `,
    [approvalRequestId, organizationId]
  );

  if (!rows[0]) {
    throw new ApprovalDecisionError(404, "not_found", "Approval request was not found.");
  }

  return rows[0];
}

async function assertEligibleReviewer(client: InstanceType<typeof Client>, organizationId: string, userId: string) {
  const { rows } = await client.query<{ role: string }>(
    `
      select role
      from memberships
      where organization_id = $1 and user_id = $2 and status = 'active'
    `,
    [organizationId, userId]
  );
  const role = rows[0]?.role;

  if (!role || !eligibleRoles.has(role)) {
    throw new ApprovalDecisionError(403, "unauthorized", "User is not eligible to decide this approval request.");
  }
}
