# Integration lifecycle and hook integrity patterns

Labels: `type:feature`, `area:installer`, `area:agent-adapter`, `area:security`, `priority:p1`

Milestone: M2

## Objective

Turn the agent integration lessons from RTK into Hookwire installer and adapter lifecycle guarantees.

## Scope

- Classify agent integrations as enforcement hooks, plugin adapters, or awareness-only guidance.
- Store each installed agent's integration tier and failure mode in the Hookwire-managed config.
- Add SHA-256 integrity metadata for the Hookwire-managed hook surface.
- Teach `hookwire doctor` to report tampered managed hook configuration.
- Add manual/no-patch installer mode for contributors who want to review exact config changes before applying.
- Add `hookwire uninstall` for removing Hookwire-managed config while preserving unrelated user configuration.
- Document policy precedence and integration tier semantics.

## Acceptance Criteria

- Installer writes integration tier, failure mode, and integrity metadata for each managed agent config.
- Doctor reports healthy integrity for freshly installed agents.
- Doctor reports tampered when a managed hook is changed after install.
- Manual/no-patch mode does not write config files or create backups.
- Uninstall removes Hookwire-managed config and Hookwire-managed Claude hook groups while preserving unrelated config.
- Public docs explain enforcement hook, plugin adapter, and awareness-only tiers.

## Verification Constraints

### Automated Checks

- Run installer unit tests for manual patch mode, integrity verification, tamper detection, and uninstall.
- Run Claude installer tests proving managed hook mutation is reported as tampered.
- Run docs verification after adding issue 022 and integration tier docs.
- Run a proof script that captures manual mode, healthy/tampered doctor output, and uninstall diffs.

### Proof Artifacts

- Attach proof JSON with temporary fixture tree summaries.
- Attach manual/no-patch action output proving no writes occurred.
- Attach healthy and tampered doctor summaries.
- Attach uninstall diff proving managed Hookwire config was removed and unrelated config remained.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on hook integrity semantics, false tamper positives, uninstall safety, and destructive-write prevention.
