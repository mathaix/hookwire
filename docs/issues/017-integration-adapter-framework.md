# Integration adapter framework

Labels: `type:feature`, `area:integration`, `area:backend`, `priority:p1`

Milestone: M3

## Objective

Create a provider-neutral integration adapter framework for external approval delivery.

## Scope

- Provider interface for delivery, callback normalization, and status updates.
- Delivery records per provider attempt.
- Retry and failure handling model.
- Provider identity mapping.
- Web inbox implemented as the first provider.

## Acceptance Criteria

- Adding Slack does not require changing approval request core logic.
- Delivery attempts are tracked independently from approval decisions.
- Provider callbacks normalize into canonical approval decisions.
- Failed deliveries can be retried or escalated.

## Verification Constraints

### Automated Checks

- Run fake-provider tests for successful delivery, provider failure, retry, timeout, escalation, and callback normalization.
- Run tests proving approval request core logic does not import provider-specific Slack/SMS/Jira/Linear code.
- Run delivery-state tests proving delivery attempts are independent from approval decisions.
- Run identity-mapping tests for provider user to Hookwire user resolution.

### Proof Artifacts

- Attach test output and fake-provider event traces.
- Attach dependency or import-boundary proof showing provider-neutral core logic.
- Attach database rows for request, delivery attempts, callback, and canonical decision.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on provider abstraction, retry semantics, callback trust boundaries, and avoiding Slack coupling.
