# OpenClaw adapter

Labels: `type:feature`, `area:agent-adapter`, `area:installer`, `priority:p1`

Milestone: M2

## Objective

Wire Hookwire into OpenClaw approval and tool-use events.

## Scope

- OpenClaw config discovery.
- Hook adapter invocation model.
- Event normalization.
- Response formatting.
- Installer and doctor support.

## Acceptance Criteria

- OpenClaw can invoke Hookwire for approval events.
- Hookwire normalizes OpenClaw events into the canonical event model.
- Installer can detect and configure OpenClaw.
- Doctor can validate OpenClaw integration state.

## Verification Constraints

### Automated Checks

- Run fixture tests for OpenClaw approval and tool-use event payloads.
- Run normalization tests proving OpenClaw payloads map to the canonical event model.
- Run installer fixture tests proving OpenClaw detection, config backup, hook insertion, and doctor validation.
- Run malformed-payload tests proving safe failure behavior.

### Proof Artifacts

- Attach test output and sanitized OpenClaw event fixtures.
- Attach canonical event snapshots generated from OpenClaw payloads.
- Attach before/after config diff for OpenClaw installation.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on OpenClaw contract assumptions, canonical normalization, and installer safety.
