# Codex adapter

Labels: `type:feature`, `area:agent-adapter`, `area:installer`, `priority:p1`

Milestone: M2

## Objective

Wire Hookwire into Codex approval and tool-use events.

## Scope

- Codex config discovery.
- Hook adapter invocation model.
- Permission request normalization.
- Shell command and filesystem action classification.
- Response formatting compatible with Codex expectations.

## Acceptance Criteria

- Codex can route approval/tool-use events to Hookwire.
- Hookwire can return allow, deny, or approval-pending decisions.
- Installer can add and validate the Codex config.
- Audit records preserve agent type and session metadata.

