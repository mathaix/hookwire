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

