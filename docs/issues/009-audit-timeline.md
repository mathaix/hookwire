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

## Verification Constraints

### Automated Checks

- Run tests that create audit events for approval creation, decision, policy change, route change, key registration, key revocation, session claim, and local override.
- Run filter tests by project, session, approval request, policy, and user.
- Run redaction tests proving secret fixture values never appear in audit details.
- Run append-only behavior tests or migration constraints preventing unsafe mutation where applicable.

### Proof Artifacts

- Attach test output and sample audit event rows.
- Attach screenshots of the audit timeline, filters, and event detail.
- Attach proof that redacted metadata is displayed instead of raw sensitive values.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on audit completeness, redaction, actor attribution, and tamper-resistance gaps.
