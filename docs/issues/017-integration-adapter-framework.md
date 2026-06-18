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

