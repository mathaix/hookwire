# Approval inbox MVP

Labels: `type:feature`, `area:web`, `priority:p0`

Milestone: M1

## Objective

Implement the first web-only approval inbox.

## Scope

- Pending approval list.
- Approval detail panel.
- Risk, policy, project, agent, route, and session metadata.
- Approve once and deny actions.
- Reason input where required.
- Empty, loading, and completed states.

## Acceptance Criteria

- A user can see pending approval requests.
- A user can inspect redacted request details.
- A user can approve or deny from the web app.
- The decision updates the request status.
- The decision is recorded as an audit event.

## Verification Constraints

### Automated Checks

- Run integration tests for pending, approved, denied, expired, unauthorized, and empty inbox states.
- Run tests proving approve and deny update request status exactly once.
- Run tests proving a decision creates an audit event in the same logical workflow.
- Run redaction assertions proving the inbox never renders known secret fixture values.

### Proof Artifacts

- Attach test output and seeded request ids used in the verification run.
- Attach screenshots for pending list, detail panel, approved state, denied state, and empty state.
- Attach database query output showing the approval request, decision row, and audit event after approval and denial.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on decision correctness, redaction leaks, authorization gaps, and UI states.
