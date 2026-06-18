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

