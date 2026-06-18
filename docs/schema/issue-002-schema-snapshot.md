# Issue 002 Schema Snapshot

Generated from `packages/db/migrations/0001_initial_schema.sql` against a clean Postgres 16 database.

## Tables

```text
agent_installations
agent_session_identities
agent_sessions
agent_tools
approval_decisions
approval_deliveries
approval_group_members
approval_groups
approval_requests
audit_events
hook_events
installation_credentials
integration_identities
integrations
memberships
on_call_assignments
on_call_schedules
onboarding_sessions
organizations
policies
policy_rules
project_memberships
projects
relay_request_nonces
route_targets
routes
schema_migrations
user_device_keys
users
```

## Tenant Model

Every tenant-owned table carries `organization_id`. Cross-tenant references use composite same-organization foreign keys where child rows reference project, route, session, integration, approval, group, or audit-owned data.

The global `organizations` and `users` tables are also protected for the application role:

- `organizations` has a select-only RLS policy scoped by `id = hookwire.current_organization_id()`.
- `users` has a select-only RLS policy that exposes users only through visible memberships for the current organization.
- `hookwire_app` has insert, update, and delete revoked on both global tables.
- `hookwire_app` has all privileges revoked on `schema_migrations`.

Representative constraints:

```text
agent_installations_revoked_by_same_org_fk | FOREIGN KEY (organization_id, revoked_by_user_id) REFERENCES memberships(organization_id, user_id)
agent_installations_revoked_state_check | CHECK status <> revoked OR revoked_at IS NOT NULL
agent_tools_project_same_org_fk | FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id) ON DELETE CASCADE
approval_requests_session_same_org_fk | FOREIGN KEY (organization_id, agent_session_id) REFERENCES agent_sessions(organization_id, id) ON DELETE CASCADE
approval_deliveries_request_same_org_fk | FOREIGN KEY (organization_id, approval_request_id) REFERENCES approval_requests(organization_id, id) ON DELETE CASCADE
audit_events_project_same_org_fk | FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id)
routes_fallback_same_org_fk | FOREIGN KEY (organization_id, fallback_route_id) REFERENCES routes(organization_id, id)
```

Representative uniqueness and replay constraints:

```text
memberships_organization_user_unique | UNIQUE (organization_id, user_id)
project_memberships_organization_project_user_unique | UNIQUE (organization_id, project_id, user_id)
projects_organization_slug_unique | UNIQUE (organization_id, slug)
installation_credentials_fingerprint_unique | UNIQUE (organization_id, key_fingerprint)
relay_request_nonces_credential_nonce_unique | UNIQUE (installation_credential_id, nonce_hash)
approval_decisions_approval_user_unique | UNIQUE (organization_id, approval_request_id, user_id)
```

## Supported Agents and Targets

```text
agent_tools_agent_type_check | claude, codex, openclaw
agent_installations_agent_type_check | claude, codex, openclaw
route_targets_target_type_check | web_inbox, slack, sms, jira, linear, email, github, webhook, local_terminal
integrations_provider_check | slack, twilio, jira, linear, github, email, webhook
```

## Application Role Isolation

The migration creates a non-owner `hookwire_app` role and row-level security policies using `app.current_organization_id`.

Representative policies:

```text
agent_sessions | agent_sessions_tenant_isolation | organization_id = hookwire.current_organization_id()
approval_requests | approval_requests_tenant_isolation | organization_id = hookwire.current_organization_id()
audit_events | audit_events_tenant_isolation | organization_id = hookwire.current_organization_id()
integrations | integrations_tenant_isolation | organization_id = hookwire.current_organization_id()
projects | projects_tenant_isolation | organization_id = hookwire.current_organization_id()
routes | routes_tenant_isolation | organization_id = hookwire.current_organization_id()
```

## Indexes

```text
agent_sessions_project_id_idx
approval_deliveries_request_id_idx
approval_requests_status_idx
audit_events_entity_idx
hook_events_session_id_idx
memberships_user_id_idx
projects_organization_id_idx
```
