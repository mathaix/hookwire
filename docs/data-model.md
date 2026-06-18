# Hookwire Data Model

The schema should support teams from the start, even if v1 ships with a simple web-only approval inbox.

## Core Tenancy

### organizations

- id
- name
- slug
- plan
- created_at
- updated_at

### users

- id
- email
- name
- avatar_url
- created_at
- updated_at

### memberships

- id
- organization_id
- user_id
- role
- status
- created_at
- updated_at

## Projects and Agents

### projects

- id
- organization_id
- name
- slug
- repo_provider
- repo_owner
- repo_name
- default_policy_id
- created_at
- updated_at

### agent_installations

- id
- organization_id
- project_id
- agent_type
- machine_fingerprint
- relay_version
- last_seen_at
- created_at
- updated_at

Supported `agent_type` values should include `claude`, `codex`, and `openclaw`.

### agent_sessions

- id
- organization_id
- project_id
- agent_installation_id
- agent_type
- external_session_id
- branch
- commit_sha
- status
- started_at
- ended_at
- last_seen_at

### hook_events

- id
- organization_id
- project_id
- agent_session_id
- event_type
- tool_name
- operation
- risk_level
- payload_redacted
- created_at

## Policy and Routing

### policies

- id
- organization_id
- project_id
- name
- version
- status
- default_decision
- created_by_user_id
- created_at
- updated_at

### policy_rules

- id
- policy_id
- name
- priority
- matcher_json
- decision
- route_id
- local_override_allowed
- require_override_reason
- max_scope
- enabled
- created_at
- updated_at

### routes

- id
- organization_id
- name
- description
- approvals_required
- timeout_seconds
- fallback_route_id
- created_at
- updated_at

### route_targets

- id
- route_id
- target_type
- integration_id
- approval_group_id
- config_json
- priority
- enabled
- created_at
- updated_at

Example `target_type` values: `web_inbox`, `slack`, `sms`, `jira`, `linear`, `email`, `github`, `webhook`, `local_terminal`.

## People, Groups, and On-Call

### approval_groups

- id
- organization_id
- name
- description
- created_at
- updated_at

### approval_group_members

- id
- approval_group_id
- user_id
- role
- created_at

### on_call_schedules

- id
- organization_id
- name
- provider
- config_json
- created_at
- updated_at

### on_call_assignments

- id
- organization_id
- approval_group_id
- user_id
- starts_at
- ends_at
- source
- created_at

## Integrations

### integrations

- id
- organization_id
- provider
- name
- status
- config_json_encrypted
- created_by_user_id
- created_at
- updated_at

Example `provider` values: `slack`, `twilio`, `jira`, `linear`, `github`, `email`, `webhook`.

### integration_identities

- id
- organization_id
- integration_id
- user_id
- external_user_id
- external_username
- external_email
- created_at
- updated_at

## Approvals and Audit

### approval_requests

- id
- organization_id
- project_id
- agent_session_id
- hook_event_id
- status
- risk_level
- route_id
- requested_by_agent
- action_summary
- redacted_payload_json
- expires_at
- created_at
- updated_at

### approval_deliveries

- id
- approval_request_id
- integration_id
- route_target_id
- provider
- destination
- status
- external_reference
- error_message
- sent_at
- completed_at
- created_at
- updated_at

### approval_decisions

- id
- approval_request_id
- organization_id
- user_id
- source
- decision
- scope
- reason
- provider
- external_reference
- created_at

### audit_events

- id
- organization_id
- project_id
- actor_type
- actor_user_id
- event_type
- entity_type
- entity_id
- metadata_json
- created_at

