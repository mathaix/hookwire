# Route and integration configuration model

Labels: `type:feature`, `area:web`, `area:backend`, `area:integration`, `priority:p1`

Milestone: M1

## Objective

Model approval routes and provider targets without hardcoding Slack as the only integration.

## Scope

- Routes list and detail page.
- Route targets for web inbox, Slack, SMS, Jira, Linear, email, GitHub, webhook, and local terminal.
- Approvals required and timeout fields.
- Fallback route support.
- Provider status placeholders.

## Acceptance Criteria

- Web inbox can be configured as the first working route target.
- Slack/SMS/Jira/Linear/etc. can be represented before provider workers exist.
- A route can target a group or on-call owner.
- A policy rule can reference a route.

