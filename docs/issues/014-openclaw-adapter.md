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

