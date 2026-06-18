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

## Verification Constraints

### Automated Checks

- Run fixture tests for Codex permission, shell, filesystem, and tool-use payloads.
- Run golden-output tests for allow, deny, and approval-pending response formats expected by Codex.
- Run installer fixture tests proving Codex config is added, backed up, and validated by doctor.
- Run audit tests proving `agent_type=codex` and session metadata survive normalization.

### Proof Artifacts

- Attach test output and sanitized Codex event fixtures.
- Attach golden response files or snapshots.
- Attach before/after config diff for Codex installation and audit row query output.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on Codex compatibility, metadata preservation, and response semantics.
