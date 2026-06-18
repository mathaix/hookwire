create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hookwire_app') then
    create role hookwire_app;
  end if;
end
$$;

create schema if not exists hookwire;

create or replace function hookwire.current_organization_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_organization_id', true), '')::uuid
$$;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  role text not null default 'member',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_organization_fk foreign key (organization_id) references organizations (id) on delete cascade,
  constraint memberships_user_fk foreign key (user_id) references users (id) on delete cascade,
  constraint memberships_role_check check (role in ('owner', 'admin', 'member', 'viewer')),
  constraint memberships_status_check check (status in ('invited', 'active', 'suspended', 'removed')),
  constraint memberships_organization_user_unique unique (organization_id, user_id),
  constraint memberships_organization_id_unique unique (organization_id, id)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  slug text not null,
  repo_provider text,
  repo_owner text,
  repo_name text,
  default_policy_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_organization_fk foreign key (organization_id) references organizations (id) on delete cascade,
  constraint projects_organization_slug_unique unique (organization_id, slug),
  constraint projects_organization_id_unique unique (organization_id, id)
);

create table project_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  user_id uuid not null,
  role text not null default 'member',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_memberships_project_same_org_fk foreign key (organization_id, project_id) references projects (organization_id, id) on delete cascade,
  constraint project_memberships_membership_same_org_fk foreign key (organization_id, user_id) references memberships (organization_id, user_id) on delete cascade,
  constraint project_memberships_role_check check (role in ('owner', 'admin', 'member', 'viewer')),
  constraint project_memberships_status_check check (status in ('invited', 'active', 'suspended', 'removed')),
  constraint project_memberships_organization_project_user_unique unique (organization_id, project_id, user_id),
  constraint project_memberships_organization_id_unique unique (organization_id, id)
);

create table user_device_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  public_key text not null,
  key_fingerprint text not null,
  key_algorithm text not null default 'ed25519',
  display_name text,
  status text not null default 'active',
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_device_keys_membership_same_org_fk foreign key (organization_id, user_id) references memberships (organization_id, user_id) on delete cascade,
  constraint user_device_keys_revoked_by_same_org_fk foreign key (organization_id, revoked_by_user_id) references memberships (organization_id, user_id),
  constraint user_device_keys_status_check check (status in ('active', 'revoked')),
  constraint user_device_keys_algorithm_check check (key_algorithm in ('ed25519')),
  constraint user_device_keys_fingerprint_unique unique (organization_id, key_fingerprint),
  constraint user_device_keys_organization_id_unique unique (organization_id, id)
);

create table agent_tools (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  agent_type text not null,
  display_name text not null,
  enabled boolean not null default true,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_tools_project_same_org_fk foreign key (organization_id, project_id) references projects (organization_id, id) on delete cascade,
  constraint agent_tools_created_by_same_org_fk foreign key (organization_id, created_by_user_id) references memberships (organization_id, user_id),
  constraint agent_tools_agent_type_check check (agent_type in ('claude', 'codex', 'openclaw')),
  constraint agent_tools_project_agent_type_unique unique (organization_id, project_id, agent_type),
  constraint agent_tools_organization_id_unique unique (organization_id, id)
);

create table agent_installations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  agent_tool_id uuid not null,
  agent_type text not null,
  registered_by_user_id uuid not null,
  owner_user_id uuid,
  machine_fingerprint text not null,
  relay_version text,
  status text not null default 'active',
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  revocation_reason text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_installations_project_same_org_fk foreign key (organization_id, project_id) references projects (organization_id, id) on delete cascade,
  constraint agent_installations_tool_same_org_fk foreign key (organization_id, agent_tool_id) references agent_tools (organization_id, id) on delete cascade,
  constraint agent_installations_registered_by_same_org_fk foreign key (organization_id, registered_by_user_id) references memberships (organization_id, user_id),
  constraint agent_installations_owner_same_org_fk foreign key (organization_id, owner_user_id) references memberships (organization_id, user_id),
  constraint agent_installations_revoked_by_same_org_fk foreign key (organization_id, revoked_by_user_id) references memberships (organization_id, user_id),
  constraint agent_installations_agent_type_check check (agent_type in ('claude', 'codex', 'openclaw')),
  constraint agent_installations_status_check check (status in ('active', 'disabled', 'revoked')),
  constraint agent_installations_revoked_state_check check (status <> 'revoked' or revoked_at is not null),
  constraint agent_installations_machine_unique unique (organization_id, project_id, agent_type, machine_fingerprint),
  constraint agent_installations_organization_id_unique unique (organization_id, id)
);

create table installation_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  agent_installation_id uuid not null,
  user_device_key_id uuid,
  public_key text not null,
  key_fingerprint text not null,
  key_algorithm text not null default 'ed25519',
  status text not null default 'active',
  last_nonce_seen_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz,
  rotated_from_credential_id uuid,
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installation_credentials_project_same_org_fk foreign key (organization_id, project_id) references projects (organization_id, id) on delete cascade,
  constraint installation_credentials_installation_same_org_fk foreign key (organization_id, agent_installation_id) references agent_installations (organization_id, id) on delete cascade,
  constraint installation_credentials_user_device_key_same_org_fk foreign key (organization_id, user_device_key_id) references user_device_keys (organization_id, id),
  constraint installation_credentials_rotated_from_same_org_fk foreign key (organization_id, rotated_from_credential_id) references installation_credentials (organization_id, id),
  constraint installation_credentials_revoked_by_same_org_fk foreign key (organization_id, revoked_by_user_id) references memberships (organization_id, user_id),
  constraint installation_credentials_status_check check (status in ('active', 'rotated', 'revoked', 'expired')),
  constraint installation_credentials_algorithm_check check (key_algorithm in ('ed25519')),
  constraint installation_credentials_fingerprint_unique unique (organization_id, key_fingerprint),
  constraint installation_credentials_organization_id_unique unique (organization_id, id)
);

create table relay_request_nonces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  installation_credential_id uuid not null,
  nonce_hash text not null,
  seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint relay_request_nonces_project_same_org_fk foreign key (organization_id, project_id) references projects (organization_id, id) on delete cascade,
  constraint relay_request_nonces_credential_same_org_fk foreign key (organization_id, installation_credential_id) references installation_credentials (organization_id, id) on delete cascade,
  constraint relay_request_nonces_credential_nonce_unique unique (installation_credential_id, nonce_hash),
  constraint relay_request_nonces_organization_id_unique unique (organization_id, id)
);

create table agent_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  agent_tool_id uuid not null,
  agent_installation_id uuid not null,
  agent_type text not null,
  external_session_id text,
  started_by_user_id uuid,
  claimed_by_user_id uuid,
  local_username_hash text,
  branch text,
  commit_sha text,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint agent_sessions_project_same_org_fk foreign key (organization_id, project_id) references projects (organization_id, id) on delete cascade,
  constraint agent_sessions_tool_same_org_fk foreign key (organization_id, agent_tool_id) references agent_tools (organization_id, id) on delete cascade,
  constraint agent_sessions_installation_same_org_fk foreign key (organization_id, agent_installation_id) references agent_installations (organization_id, id) on delete cascade,
  constraint agent_sessions_started_by_same_org_fk foreign key (organization_id, started_by_user_id) references memberships (organization_id, user_id),
  constraint agent_sessions_claimed_by_same_org_fk foreign key (organization_id, claimed_by_user_id) references memberships (organization_id, user_id),
  constraint agent_sessions_agent_type_check check (agent_type in ('claude', 'codex', 'openclaw')),
  constraint agent_sessions_status_check check (status in ('active', 'idle', 'ended', 'errored')),
  constraint agent_sessions_external_session_unique unique (organization_id, project_id, agent_type, external_session_id),
  constraint agent_sessions_organization_id_unique unique (organization_id, id)
);

create table agent_session_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_session_id uuid not null,
  user_id uuid,
  source text not null,
  confidence numeric(5, 4) not null default 1,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint agent_session_identities_session_same_org_fk foreign key (organization_id, agent_session_id) references agent_sessions (organization_id, id) on delete cascade,
  constraint agent_session_identities_user_same_org_fk foreign key (organization_id, user_id) references memberships (organization_id, user_id),
  constraint agent_session_identities_source_check check (source in ('installation_owner', 'cli_login', 'manual_claim', 'git_author', 'external_mapping', 'service_account')),
  constraint agent_session_identities_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint agent_session_identities_organization_id_unique unique (organization_id, id)
);

create table hook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  agent_session_id uuid not null,
  event_type text not null,
  tool_name text,
  operation text,
  risk_level text not null default 'unknown',
  payload_redacted jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hook_events_project_same_org_fk foreign key (organization_id, project_id) references projects (organization_id, id) on delete cascade,
  constraint hook_events_session_same_org_fk foreign key (organization_id, agent_session_id) references agent_sessions (organization_id, id) on delete cascade,
  constraint hook_events_risk_level_check check (risk_level in ('unknown', 'low', 'medium', 'high', 'critical')),
  constraint hook_events_organization_id_unique unique (organization_id, id)
);

create table routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  description text,
  approvals_required integer not null default 1,
  timeout_seconds integer not null default 900,
  fallback_route_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routes_organization_fk foreign key (organization_id) references organizations (id) on delete cascade,
  constraint routes_fallback_same_org_fk foreign key (organization_id, fallback_route_id) references routes (organization_id, id),
  constraint routes_approvals_required_check check (approvals_required > 0),
  constraint routes_timeout_seconds_check check (timeout_seconds > 0),
  constraint routes_name_unique unique (organization_id, name),
  constraint routes_organization_id_unique unique (organization_id, id)
);

create table policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  name text not null,
  version integer not null default 1,
  status text not null default 'draft',
  default_decision text not null default 'ask',
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policies_project_same_org_fk foreign key (organization_id, project_id) references projects (organization_id, id) on delete cascade,
  constraint policies_created_by_same_org_fk foreign key (organization_id, created_by_user_id) references memberships (organization_id, user_id),
  constraint policies_status_check check (status in ('draft', 'active', 'archived')),
  constraint policies_default_decision_check check (default_decision in ('allow', 'deny', 'ask')),
  constraint policies_project_name_version_unique unique (organization_id, project_id, name, version),
  constraint policies_organization_id_unique unique (organization_id, id)
);

alter table projects
  add constraint projects_default_policy_same_org_fk
  foreign key (organization_id, default_policy_id) references policies (organization_id, id);

create table policy_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  policy_id uuid not null,
  name text not null,
  priority integer not null,
  matcher_json jsonb not null default '{}'::jsonb,
  decision text not null,
  route_id uuid,
  local_override_allowed boolean not null default false,
  require_override_reason boolean not null default false,
  max_scope text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policy_rules_policy_same_org_fk foreign key (organization_id, policy_id) references policies (organization_id, id) on delete cascade,
  constraint policy_rules_route_same_org_fk foreign key (organization_id, route_id) references routes (organization_id, id),
  constraint policy_rules_decision_check check (decision in ('allow', 'deny', 'ask')),
  constraint policy_rules_priority_unique unique (organization_id, policy_id, priority),
  constraint policy_rules_organization_id_unique unique (organization_id, id)
);

create table approval_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_groups_organization_fk foreign key (organization_id) references organizations (id) on delete cascade,
  constraint approval_groups_name_unique unique (organization_id, name),
  constraint approval_groups_organization_id_unique unique (organization_id, id)
);

create table approval_group_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  approval_group_id uuid not null,
  user_id uuid not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  constraint approval_group_members_group_same_org_fk foreign key (organization_id, approval_group_id) references approval_groups (organization_id, id) on delete cascade,
  constraint approval_group_members_user_same_org_fk foreign key (organization_id, user_id) references memberships (organization_id, user_id) on delete cascade,
  constraint approval_group_members_role_check check (role in ('manager', 'member')),
  constraint approval_group_members_group_user_unique unique (organization_id, approval_group_id, user_id),
  constraint approval_group_members_organization_id_unique unique (organization_id, id)
);

create table on_call_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  provider text not null,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint on_call_schedules_organization_fk foreign key (organization_id) references organizations (id) on delete cascade,
  constraint on_call_schedules_provider_check check (provider in ('manual', 'slack', 'pagerduty', 'opsgenie')),
  constraint on_call_schedules_name_unique unique (organization_id, name),
  constraint on_call_schedules_organization_id_unique unique (organization_id, id)
);

create table on_call_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  approval_group_id uuid not null,
  user_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  constraint on_call_assignments_group_same_org_fk foreign key (organization_id, approval_group_id) references approval_groups (organization_id, id) on delete cascade,
  constraint on_call_assignments_user_same_org_fk foreign key (organization_id, user_id) references memberships (organization_id, user_id) on delete cascade,
  constraint on_call_assignments_time_check check (ends_at is null or ends_at > starts_at),
  constraint on_call_assignments_organization_id_unique unique (organization_id, id)
);

create table integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  provider text not null,
  name text not null,
  status text not null default 'inactive',
  config_json_encrypted jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integrations_organization_fk foreign key (organization_id) references organizations (id) on delete cascade,
  constraint integrations_created_by_same_org_fk foreign key (organization_id, created_by_user_id) references memberships (organization_id, user_id),
  constraint integrations_provider_check check (provider in ('slack', 'twilio', 'jira', 'linear', 'github', 'email', 'webhook')),
  constraint integrations_status_check check (status in ('inactive', 'active', 'error', 'disabled')),
  constraint integrations_name_unique unique (organization_id, provider, name),
  constraint integrations_organization_id_unique unique (organization_id, id)
);

create table integration_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  integration_id uuid not null,
  user_id uuid not null,
  external_user_id text not null,
  external_username text,
  external_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_identities_integration_same_org_fk foreign key (organization_id, integration_id) references integrations (organization_id, id) on delete cascade,
  constraint integration_identities_user_same_org_fk foreign key (organization_id, user_id) references memberships (organization_id, user_id) on delete cascade,
  constraint integration_identities_external_user_unique unique (organization_id, integration_id, external_user_id),
  constraint integration_identities_user_unique unique (organization_id, integration_id, user_id),
  constraint integration_identities_organization_id_unique unique (organization_id, id)
);

create table route_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  route_id uuid not null,
  target_type text not null,
  integration_id uuid,
  approval_group_id uuid,
  config_json jsonb not null default '{}'::jsonb,
  priority integer not null default 100,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint route_targets_route_same_org_fk foreign key (organization_id, route_id) references routes (organization_id, id) on delete cascade,
  constraint route_targets_integration_same_org_fk foreign key (organization_id, integration_id) references integrations (organization_id, id),
  constraint route_targets_approval_group_same_org_fk foreign key (organization_id, approval_group_id) references approval_groups (organization_id, id),
  constraint route_targets_target_type_check check (target_type in ('web_inbox', 'slack', 'sms', 'jira', 'linear', 'email', 'github', 'webhook', 'local_terminal')),
  constraint route_targets_priority_unique unique (organization_id, route_id, priority),
  constraint route_targets_organization_id_unique unique (organization_id, id)
);

create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  agent_tool_id uuid not null,
  agent_installation_id uuid not null,
  agent_session_id uuid not null,
  hook_event_id uuid,
  status text not null default 'pending',
  risk_level text not null default 'unknown',
  route_id uuid not null,
  requested_by_agent text not null,
  action_summary text not null,
  redacted_payload_json jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_project_same_org_fk foreign key (organization_id, project_id) references projects (organization_id, id) on delete cascade,
  constraint approval_requests_tool_same_org_fk foreign key (organization_id, agent_tool_id) references agent_tools (organization_id, id) on delete cascade,
  constraint approval_requests_installation_same_org_fk foreign key (organization_id, agent_installation_id) references agent_installations (organization_id, id) on delete cascade,
  constraint approval_requests_session_same_org_fk foreign key (organization_id, agent_session_id) references agent_sessions (organization_id, id) on delete cascade,
  constraint approval_requests_hook_event_same_org_fk foreign key (organization_id, hook_event_id) references hook_events (organization_id, id),
  constraint approval_requests_route_same_org_fk foreign key (organization_id, route_id) references routes (organization_id, id),
  constraint approval_requests_status_check check (status in ('pending', 'approved', 'denied', 'expired', 'cancelled')),
  constraint approval_requests_risk_level_check check (risk_level in ('unknown', 'low', 'medium', 'high', 'critical')),
  constraint approval_requests_organization_id_unique unique (organization_id, id)
);

create table approval_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  approval_request_id uuid not null,
  integration_id uuid,
  route_target_id uuid,
  provider text not null,
  destination text not null,
  status text not null default 'pending',
  external_reference text,
  error_message text,
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_deliveries_request_same_org_fk foreign key (organization_id, approval_request_id) references approval_requests (organization_id, id) on delete cascade,
  constraint approval_deliveries_integration_same_org_fk foreign key (organization_id, integration_id) references integrations (organization_id, id),
  constraint approval_deliveries_route_target_same_org_fk foreign key (organization_id, route_target_id) references route_targets (organization_id, id),
  constraint approval_deliveries_provider_check check (provider in ('web_inbox', 'slack', 'sms', 'twilio', 'jira', 'linear', 'github', 'email', 'webhook', 'local_terminal')),
  constraint approval_deliveries_status_check check (status in ('pending', 'sent', 'delivered', 'failed', 'completed', 'cancelled')),
  constraint approval_deliveries_organization_id_unique unique (organization_id, id)
);

create table approval_decisions (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null,
  organization_id uuid not null,
  user_id uuid,
  source text not null,
  decision text not null,
  scope text not null default 'once',
  reason text,
  provider text,
  external_reference text,
  created_at timestamptz not null default now(),
  constraint approval_decisions_request_same_org_fk foreign key (organization_id, approval_request_id) references approval_requests (organization_id, id) on delete cascade,
  constraint approval_decisions_user_same_org_fk foreign key (organization_id, user_id) references memberships (organization_id, user_id),
  constraint approval_decisions_source_check check (source in ('web', 'integration', 'local_terminal')),
  constraint approval_decisions_decision_check check (decision in ('approved', 'denied')),
  constraint approval_decisions_scope_check check (scope in ('once', 'session', 'project', 'policy_rule')),
  constraint approval_decisions_approval_user_unique unique (organization_id, approval_request_id, user_id),
  constraint approval_decisions_organization_id_unique unique (organization_id, id)
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid,
  actor_type text not null,
  actor_user_id uuid,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_organization_fk foreign key (organization_id) references organizations (id) on delete cascade,
  constraint audit_events_project_same_org_fk foreign key (organization_id, project_id) references projects (organization_id, id),
  constraint audit_events_actor_user_same_org_fk foreign key (organization_id, actor_user_id) references memberships (organization_id, user_id),
  constraint audit_events_actor_type_check check (actor_type in ('user', 'relay', 'integration', 'system')),
  constraint audit_events_organization_id_unique unique (organization_id, id)
);

create table onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  project_id uuid,
  status text not null default 'pending',
  device_code_hash text not null,
  user_device_key_id uuid,
  public_key_challenge text not null,
  selected_agent_types text[] not null default '{}'::text[],
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_sessions_membership_same_org_fk foreign key (organization_id, user_id) references memberships (organization_id, user_id) on delete cascade,
  constraint onboarding_sessions_project_same_org_fk foreign key (organization_id, project_id) references projects (organization_id, id),
  constraint onboarding_sessions_user_device_key_same_org_fk foreign key (organization_id, user_device_key_id) references user_device_keys (organization_id, id),
  constraint onboarding_sessions_status_check check (status in ('pending', 'completed', 'expired', 'cancelled')),
  constraint onboarding_sessions_agent_types_check check (selected_agent_types <@ array['claude', 'codex', 'openclaw']::text[]),
  constraint onboarding_sessions_device_code_unique unique (organization_id, device_code_hash),
  constraint onboarding_sessions_organization_id_unique unique (organization_id, id)
);

create index memberships_user_id_idx on memberships (user_id);
create index projects_organization_id_idx on projects (organization_id);
create index agent_sessions_project_id_idx on agent_sessions (organization_id, project_id);
create index hook_events_session_id_idx on hook_events (organization_id, agent_session_id);
create index approval_requests_status_idx on approval_requests (organization_id, status, created_at desc);
create index approval_deliveries_request_id_idx on approval_deliveries (organization_id, approval_request_id);
create index audit_events_entity_idx on audit_events (organization_id, entity_type, entity_id);

do $$
declare
  tenant_table text;
begin
  foreach tenant_table in array array[
    'memberships',
    'project_memberships',
    'user_device_keys',
    'projects',
    'agent_tools',
    'agent_installations',
    'installation_credentials',
    'relay_request_nonces',
    'agent_sessions',
    'agent_session_identities',
    'hook_events',
    'routes',
    'policies',
    'policy_rules',
    'approval_groups',
    'approval_group_members',
    'on_call_schedules',
    'on_call_assignments',
    'integrations',
    'integration_identities',
    'route_targets',
    'approval_requests',
    'approval_deliveries',
    'approval_decisions',
    'audit_events',
    'onboarding_sessions'
  ]
  loop
    execute format('alter table %I enable row level security', tenant_table);
    execute format('alter table %I force row level security', tenant_table);
    execute format(
      'create policy %I on %I using (organization_id = hookwire.current_organization_id()) with check (organization_id = hookwire.current_organization_id())',
      tenant_table || '_tenant_isolation',
      tenant_table
    );
  end loop;
end
$$;

alter table organizations enable row level security;
alter table organizations force row level security;
create policy organizations_tenant_select
  on organizations
  for select
  using (id = hookwire.current_organization_id());

alter table users enable row level security;
alter table users force row level security;
create policy users_tenant_select
  on users
  for select
  using (
    exists (
      select 1
      from memberships
      where memberships.user_id = users.id
        and memberships.organization_id = hookwire.current_organization_id()
    )
  );

grant usage on schema public to hookwire_app;
grant usage on schema hookwire to hookwire_app;
grant select, insert, update, delete on all tables in schema public to hookwire_app;
revoke insert, update, delete on organizations, users from hookwire_app;
revoke all on schema_migrations from hookwire_app;
grant execute on all functions in schema hookwire to hookwire_app;
