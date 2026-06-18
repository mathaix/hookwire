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

