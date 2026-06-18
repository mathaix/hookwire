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

## Verification Constraints

### Automated Checks

- Run Slack adapter tests for channel delivery, user delivery, callback signature verification, approve action, deny action, unauthorized Slack user, stale interaction, and provider failure.
- Run identity-mapping tests from Slack user id to Hookwire user id.
- Run tests proving Slack decisions create canonical approval decision rows.
- Run failure-isolation tests proving web inbox approvals still work when Slack delivery fails.

### Proof Artifacts

- Attach test output with sanitized Slack request and callback fixtures.
- Attach message payload snapshots for initial request and post-decision update.
- Attach database query output for delivery, identity mapping, decision, and audit event rows.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on Slack signature validation, identity eligibility, failure isolation, and canonical decision mapping.
