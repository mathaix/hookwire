# Installer detection and config backup framework

Labels: `type:feature`, `area:installer`, `priority:p0`

Milestone: M2

## Objective

Build the installer framework that detects agent runtimes and safely modifies hook configuration.

## Scope

- `hookwire init` command.
- Agent detection for Claude Code, Codex, and OpenClaw.
- Config file discovery.
- Config backup before modification.
- Dry-run mode.
- Doctor checks.

## Acceptance Criteria

- Installer reports detected agents.
- Installer backs up every file before writing.
- Installer can run in dry-run mode.
- Doctor can identify missing or drifted hook config.
- Installer avoids destructive writes.

## Verification Constraints

### Automated Checks

- Run installer tests against temporary home/project directories for detected, missing, and partially configured agent states.
- Run dry-run tests proving no files are modified.
- Run backup tests proving existing config files are copied before mutation.
- Run doctor tests for valid, missing, drifted, and stale Hookwire hook configs.

### Proof Artifacts

- Attach test output and temporary fixture tree summaries before and after installer runs.
- Attach diff output showing expected config changes and backup files.
- Attach doctor command output for healthy and drifted fixtures.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on destructive-write prevention, backup correctness, cross-platform paths, and recovery behavior.
