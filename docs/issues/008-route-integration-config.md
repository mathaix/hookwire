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

## Verification Constraints

### Automated Checks

- Run CRUD tests for routes and route targets.
- Run tests for provider target types: web inbox, Slack, SMS, Jira, Linear, email, GitHub, webhook, and local terminal.
- Run fallback-route validation tests, including cycle prevention.
- Run tests proving a policy rule can reference a route and that deleting/disabling a route is handled safely.

### Proof Artifacts

- Attach test output and route fixture data covering every provider type.
- Attach screenshots for route list, route detail, target editor, approvals-required, timeout, and fallback fields.
- Attach database query output showing route targets for group-based and on-call-based routing.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on provider-neutral routing, fallback behavior, and avoiding Slack-specific coupling.
