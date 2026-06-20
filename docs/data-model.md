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

### user_device_keys

- id
- organization_id
- user_id
- public_key
- key_fingerprint
- key_algorithm
- display_name
- status
- last_used_at
- revoked_at
- revoked_by_user_id
- created_at
- updated_at

Used for CLI/device identity created during onboarding. Private keys are generated and stored locally; only public keys are persisted by the backend.

### memberships

- id
- organization_id
- user_id
- role
- status
- created_at
- updated_at

### project_memberships

- id
- organization_id
- project_id
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

### agent_tools

- id
- organization_id
- project_id
- agent_type
- display_name
- enabled
- created_by_user_id
- created_at
- updated_at

Supported `agent_type` values should include `claude`, `codex`, and `openclaw`.

### agent_installations

- id
- organization_id
- project_id
- agent_tool_id
- agent_type
- registered_by_user_id
- owner_user_id
- machine_fingerprint
- relay_version
- status
- revoked_at
- revoked_by_user_id
- revocation_reason
- last_seen_at
- created_at
- updated_at

`registered_by_user_id` records who completed onboarding. `owner_user_id` is nullable for shared machines, CI, or service-owned installations.

### installation_credentials

- id
- organization_id
- project_id
- agent_installation_id
- user_device_key_id
- public_key
- key_fingerprint
- key_algorithm
- status
- last_nonce_seen_at
- last_used_at
- expires_at
- rotated_from_credential_id
- revoked_at
- revoked_by_user_id
- revocation_reason
- created_at
- updated_at

`installation_credentials` should be asymmetric signing credentials, not bearer tokens. The relay signs requests with the local private key; the backend verifies signatures with the registered public key and rejects revoked credentials.

### relay_request_nonces

- id
- organization_id
- project_id
- installation_credential_id
- nonce_hash
- seen_at
- expires_at

Used to prevent replay of signed relay requests within the accepted clock-skew window.

### agent_sessions

- id
- organization_id
- project_id
- agent_tool_id
- agent_installation_id
- agent_type
- external_session_id
- started_by_user_id
- claimed_by_user_id
- local_username_hash
- branch
- commit_sha
- status
- started_at
- ended_at
- last_seen_at
- updated_at

`started_by_user_id` is the best-known human owner from onboarding or explicit local login. `claimed_by_user_id` is set when a web user manually claims a session. Both are nullable and must be tracked in audit events when changed.

### agent_session_identities

- id
- organization_id
- agent_session_id
- user_id
- source
- confidence
- metadata_json
- created_at

Example `source` values: `installation_owner`, `cli_login`, `manual_claim`, `git_author`, `external_mapping`, `service_account`.

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

## Onboarding

### onboarding_sessions

- id
- organization_id
- user_id
- project_id
- status
- device_code_hash
- user_device_key_id
- public_key_challenge
- selected_agent_types
- expires_at
- completed_at
- created_at
- updated_at

Used by web-to-CLI login or device-code setup. Completion registers `agent_tools`, `agent_installations`, public-key-backed `installation_credentials`, and optionally a reusable `user_device_key`.

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
- organization_id
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

Rules are evaluated by ascending `priority`; priorities are unique within a policy. `decision` is one of `allow`, `deny`, `ask`, or `route`. Route decisions must reference a same-organization `route_id`; non-route decisions must not carry a `route_id`. `matcher_json` stores command prefix, command pattern, operation, path pattern, and risk tag matchers. Local overrides can require a reason and can be scoped by `max_scope` (`once`, `session`, or `project`).

### routes

- id
- organization_id
- name
- description
- approvals_required
- timeout_seconds
- fallback_route_id
- enabled
- created_at
- updated_at

### route_targets

- id
- organization_id
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
- organization_id
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
- agent_tool_id
- agent_installation_id
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
- organization_id
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
