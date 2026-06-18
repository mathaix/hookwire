# Session explorer

Labels: `type:feature`, `area:web`, `area:backend`, `priority:p1`

Milestone: M1

## Objective

Show agent sessions across projects and runtimes.

## Scope

- Session list by project.
- Filters for agent type, status, risk, and date.
- Session detail view with hook events, approvals, and decisions.
- Session summary metrics.

## Acceptance Criteria

- Users can see Claude, Codex, and OpenClaw sessions in one place.
- Session detail links approvals and hook events.
- Sensitive payloads remain redacted.
- Sessions can be filtered by project and agent type.

## Verification Constraints

### Automated Checks

- Run tests for session list filtering by project, agent type, status, risk, and date.
- Run tests proving session detail includes linked hook events, approval requests, and decisions.
- Run tenant-isolation tests for session access.
- Run redaction fixture tests for event payload rendering.

### Proof Artifacts

- Attach test output and seeded session ids for Claude, Codex, and OpenClaw.
- Attach screenshots of session list filters and session detail.
- Attach query output showing session-to-event-to-approval relationships.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on cross-agent consistency, authorization, redaction, and filter correctness.
