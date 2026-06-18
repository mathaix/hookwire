# Approval decision API

Labels: `type:feature`, `area:backend`, `priority:p0`

Milestone: M1

## Objective

Create the backend API for recording approval decisions from the web inbox.

## Scope

- Endpoint to approve a request.
- Endpoint to deny a request.
- Decision validation against request status and user eligibility.
- Decision reason support.
- Audit event creation in the same logical workflow.

## Acceptance Criteria

- Only pending requests can be decided.
- Decisions are idempotent or safely rejected on repeat.
- The deciding user is recorded.
- Request status changes are persisted.
- Audit event records source, actor, decision, scope, and reason.

## Verification Constraints

### Automated Checks

- Run API tests for approve, deny, repeat approve, repeat deny, expired request, unauthorized user, and wrong-organization user.
- Run transaction tests proving request status, decision row, and audit event cannot partially commit.
- Run validation tests for required reason and allowed decision scopes.

### Proof Artifacts

- Attach API test output with request/response status codes.
- Attach database query output showing the request status, decision actor, decision source, scope, reason, and audit event metadata.
- Attach proof of repeat-decision behavior, either idempotent response or explicit safe rejection.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on authorization, idempotency, transaction boundaries, and audit completeness.
