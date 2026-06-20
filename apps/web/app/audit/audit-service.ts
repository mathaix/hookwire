import pg from "pg";
import {
  auditEventTypes,
  redactAuditMetadata,
  type AuditActorType,
  type AuditEntityType,
  type AuditEventRecord,
  type AuditEventType,
  type AuditMetadata
} from "./domain";

const { Client } = pg;

export type AuditServiceInput = {
  databaseRole?: string | null;
  databaseUrl?: string;
  organizationId: string;
};

export type AppendAuditEventInput = AuditServiceInput & {
  actorType: AuditActorType;
  actorUserId?: string | null;
  entityId?: string | null;
  entityType: AuditEntityType;
  eventType: AuditEventType;
  metadata?: AuditMetadata;
  projectId?: string | null;
};

export type ListAuditEventsInput = AuditServiceInput & {
  actorUserId?: string | null;
  entityId?: string | null;
  entityType?: AuditEntityType | null;
  limit?: number;
  projectId?: string | null;
};

type AuditEventRow = {
  actor_type: AuditActorType;
  actor_user_email: string | null;
  actor_user_id: string | null;
  actor_user_name: string | null;
  created_at: Date;
  entity_id: string | null;
  entity_type: AuditEntityType;
  event_type: AuditEventType;
  id: string;
  metadata_json: AuditMetadata;
  project_id: string | null;
  project_name: string | null;
};

const eventTypeSet = new Set<string>(auditEventTypes);
const actorTypes = new Set<string>(["user", "relay", "integration", "system"]);
const entityTypes = new Set<string>([
  "approval_request",
  "approval_decision",
  "policy",
  "route",
  "user_device_key",
  "agent_session",
  "local_override"
]);

export class AuditServiceError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AuditServiceError";
    this.status = status;
    this.code = code;
  }
}

export async function appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEventRecord> {
  return withTenantClient(input, async (client) => {
    validateAuditEventInput(input);
    const metadata = redactAuditMetadata(input.metadata ?? {});
    const { rows } = await client.query<AuditEventRow>(
      `
        insert into audit_events (
          organization_id, project_id, actor_type, actor_user_id,
          event_type, entity_type, entity_id, metadata_json
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning
          id,
          project_id,
          null::text as project_name,
          actor_type,
          actor_user_id,
          null::text as actor_user_name,
          null::text as actor_user_email,
          event_type,
          entity_type,
          entity_id,
          metadata_json,
          created_at
      `,
      [
        input.organizationId,
        input.projectId ?? null,
        input.actorType,
        input.actorUserId ?? null,
        input.eventType,
        input.entityType,
        input.entityId ?? null,
        JSON.stringify(metadata)
      ]
    );

    return (await hydrateAuditRows(client, input.organizationId, rows)).at(0)!;
  });
}

export async function listAuditEvents(input: ListAuditEventsInput): Promise<{ events: AuditEventRecord[] }> {
  return withTenantClient(input, async (client) => {
    validateListInput(input);
    const { rows } = await client.query<AuditEventRow>(
      `
        select
          ae.id,
          ae.project_id,
          p.name as project_name,
          ae.actor_type,
          ae.actor_user_id,
          u.name as actor_user_name,
          u.email as actor_user_email,
          ae.event_type,
          ae.entity_type,
          ae.entity_id,
          ae.metadata_json,
          ae.created_at
        from audit_events ae
        left join projects p on p.organization_id = ae.organization_id and p.id = ae.project_id
        left join users u on u.id = ae.actor_user_id
        where ae.organization_id = $1
          and ($2::uuid is null or ae.project_id = $2)
          and ($3::text is null or ae.entity_type = $3)
          and ($4::uuid is null or ae.entity_id = $4)
          and ($5::uuid is null or ae.actor_user_id = $5)
        order by ae.created_at desc, ae.id desc
        limit $6
      `,
      [
        input.organizationId,
        input.projectId ?? null,
        input.entityType ?? null,
        input.entityId ?? null,
        input.actorUserId ?? null,
        input.limit ?? 100
      ]
    );

    return { events: rows.map(mapAuditRow) };
  });
}

async function withTenantClient<T>(
  input: { databaseRole?: string | null; databaseUrl?: string; organizationId: string },
  callback: (client: InstanceType<typeof Client>) => Promise<T>
) {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new AuditServiceError(500, "database_not_configured", "DATABASE_URL is required.");
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

async function hydrateAuditRows(
  client: InstanceType<typeof Client>,
  organizationId: string,
  rows: AuditEventRow[]
): Promise<AuditEventRecord[]> {
  if (rows.length === 0) {
    return [];
  }
  const { rows: hydrated } = await client.query<AuditEventRow>(
    `
      select
        ae.id,
        ae.project_id,
        p.name as project_name,
        ae.actor_type,
        ae.actor_user_id,
        u.name as actor_user_name,
        u.email as actor_user_email,
        ae.event_type,
        ae.entity_type,
        ae.entity_id,
        ae.metadata_json,
        ae.created_at
      from audit_events ae
      left join projects p on p.organization_id = ae.organization_id and p.id = ae.project_id
      left join users u on u.id = ae.actor_user_id
      where ae.organization_id = $1 and ae.id = any($2::uuid[])
      order by ae.created_at desc, ae.id desc
    `,
    [organizationId, rows.map((row) => row.id)]
  );

  return hydrated.map(mapAuditRow);
}

function mapAuditRow(row: AuditEventRow): AuditEventRecord {
  return {
    actor: {
      type: row.actor_type,
      userEmail: row.actor_user_email,
      userId: row.actor_user_id,
      userName: row.actor_user_name ?? labelActor(row.actor_type)
    },
    createdAt: row.created_at.toISOString(),
    entityId: row.entity_id,
    entityType: row.entity_type,
    eventType: row.event_type,
    id: row.id,
    metadata: redactAuditMetadata(row.metadata_json),
    projectId: row.project_id,
    projectName: row.project_name
  };
}

function labelActor(actorType: AuditActorType): string {
  switch (actorType) {
    case "integration":
      return "Integration";
    case "relay":
      return "Relay";
    case "system":
      return "System";
    case "user":
      return "User";
  }
}

function validateAuditEventInput(input: AppendAuditEventInput) {
  if (!eventTypeSet.has(input.eventType)) {
    throw new AuditServiceError(400, "invalid_event_type", "Audit event type is not supported.");
  }
  if (!actorTypes.has(input.actorType)) {
    throw new AuditServiceError(400, "invalid_actor_type", "Audit actor type is not supported.");
  }
  if (input.actorType === "user" && !input.actorUserId) {
    throw new AuditServiceError(400, "actor_user_required", "User audit events require an actor user.");
  }
  if (!entityTypes.has(input.entityType)) {
    throw new AuditServiceError(400, "invalid_entity_type", "Audit entity type is not supported.");
  }
}

function validateListInput(input: ListAuditEventsInput) {
  if (input.entityType && !entityTypes.has(input.entityType)) {
    throw new AuditServiceError(400, "invalid_entity_type", "Audit entity type is not supported.");
  }
  if (input.limit !== undefined && (input.limit < 1 || input.limit > 500)) {
    throw new AuditServiceError(400, "invalid_limit", "Audit query limit must be between 1 and 500.");
  }
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new AuditServiceError(500, "invalid_database_role", "Database role contains invalid characters.");
  }

  return `"${identifier.replaceAll('"', '""')}"`;
}
