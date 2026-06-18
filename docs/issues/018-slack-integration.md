# Slack integration adapter

Labels: `type:feature`, `area:integration`, `priority:p1`

Milestone: M3

## Objective

Implement Slack as the first external approval integration.

## Scope

- Slack app installation model.
- Workspace and channel configuration.
- Slack user to Hookwire user mapping.
- Approval message formatting.
- Approve and deny interactive callbacks.
- Audit and delivery status updates.

## Acceptance Criteria

- A route can deliver an approval request to a Slack channel or user.
- Slack callbacks verify identity and eligibility.
- Slack decisions create canonical approval decisions.
- Slack message state updates after approval or denial.
- Slack failures do not block web inbox approvals.

