# Multiuser database schema

Labels: `type:feature`, `area:data-model`, `area:backend`, `priority:p0`

Milestone: M1

## Objective

Design and implement the first Postgres schema for a multiuser Hookwire control plane.

## Scope

- Organizations, users, memberships, and roles.
- Projects and agent installations.
- Agent sessions and hook events.
- Policies, policy rules, routes, and route targets.
- Approval groups and on-call assignments.
- Integrations and provider identity mappings.
- Approval requests, deliveries, decisions, and audit events.

## Acceptance Criteria

- Schema supports multiple organizations.
- Schema supports multiple users per organization with roles.
- Schema supports Claude, Codex, and OpenClaw installations.
- Schema supports web inbox approvals without Slack.
- Schema can represent Slack, SMS, Jira, Linear, GitHub, email, and webhook targets for later integration workers.
- Migrations are repeatable in local development.

## Verification Constraints

### Automated Checks

- Run migrations against a clean local Postgres database.
- Run the reset path and re-apply migrations to prove repeatability.
- Run schema tests that assert required foreign keys, uniqueness constraints, tenant scoping fields, and non-null fields.
- Run tenant-isolation query tests proving one organization cannot read or mutate another organization's projects, sessions, approvals, routes, integrations, or audit events.

### Proof Artifacts

- Attach migration command output, table list, and constraint/index summary.
- Attach test output for tenant isolation and relation integrity.
- Include a generated schema snapshot or ERD artifact in the PR when the schema changes materially.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on tenant isolation, referential integrity, missing revocation fields, and whether the schema supports all current issue specs.
