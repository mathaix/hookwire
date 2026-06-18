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

