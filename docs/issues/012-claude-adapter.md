# Claude Code adapter

Labels: `type:feature`, `area:agent-adapter`, `area:installer`, `priority:p1`

Milestone: M2

## Objective

Wire Hookwire into Claude Code hook events.

## Scope

- Claude Code hook config generation.
- `hookwire hook --agent claude --event ...` invocation.
- PreToolUse normalization.
- PermissionRequest normalization where available.
- PostToolUse audit capture.

## Acceptance Criteria

- Claude Code can invoke Hookwire hook adapter.
- Hookwire receives and normalizes Claude events.
- Allow, deny, and ask responses map to Claude-compatible output.
- Installer can add and validate the Claude config.

