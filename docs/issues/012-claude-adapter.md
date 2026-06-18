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

## Verification Constraints

### Automated Checks

- Run fixture tests for Claude PreToolUse, PermissionRequest, and PostToolUse payloads.
- Run golden-output tests for allow, deny, and ask responses expected by Claude Code.
- Run installer fixture tests proving Claude hook config is added, backed up, and validated by doctor.
- Run malformed-payload tests proving safe failure behavior.

### Proof Artifacts

- Attach test output and sanitized Claude event fixtures.
- Attach golden response files or snapshots.
- Attach before/after config diff for Claude installation.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on Claude hook compatibility, thin-adapter boundaries, and safe handling of malformed events.
