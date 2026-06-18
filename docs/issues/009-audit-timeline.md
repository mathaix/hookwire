# Audit timeline

Labels: `type:feature`, `area:audit`, `area:web`, `area:backend`, `priority:p1`

Milestone: M1

## Objective

Expose a clear audit trail for sessions, approvals, policy changes, and decisions.

## Scope

- Audit event persistence.
- Audit timeline page.
- Entity filters for project, session, approval request, policy, and user.
- Event details with redacted metadata.

## Acceptance Criteria

- Approval creation and decision events are visible.
- Policy changes are visible.
- Local override events can be represented.
- Audit details never expose unredacted secrets.

