# Local redaction pipeline

Labels: `type:feature`, `area:local-relay`, `area:security`, `priority:p0`

Milestone: M2

## Objective

Redact sensitive payloads locally before sending approval metadata upstream.

## Scope

- Path-based sensitivity detection.
- Secret regex patterns.
- Private key block detection.
- Database URL detection.
- Token-like string detection.
- Redaction metadata in approval requests and audit events.

## Acceptance Criteria

- `.env`, private keys, API tokens, and credential-like values are redacted.
- Redaction runs before backend submission.
- Redaction avoids LLM calls in the hot path.
- Redacted fields are clearly marked in payload metadata.

## Verification Constraints

### Automated Checks

- Run fixture tests for `.env`, private keys, API tokens, database URLs, high-entropy strings, credential-like paths, stack traces, and command output.
- Run negative tests proving ordinary low-risk metadata remains useful after redaction.
- Run tests proving redaction executes before backend submission serialization.
- Run static import/dependency checks and hot-path unit tests proving no LLM call exists in the redaction hot path.

### Proof Artifacts

- Attach test output with secret fixture values represented only by hashes or labels.
- Attach before/after redaction snapshots with raw secrets removed.
- Attach proof that redacted payload metadata marks which fields were changed.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on secret leakage, ordering before upload, deterministic behavior, and false-negative fixtures.
