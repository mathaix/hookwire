# Issue 022: Integration Lifecycle and Hook Integrity Review

Issue: [Integration lifecycle and hook integrity](../issues/022-integration-lifecycle-and-hook-integrity.md)

Proof artifact: [2026-06-22-issue-022-integration-patterns-proof.json](2026-06-22-issue-022-integration-patterns-proof.json)

Working tree state: pre-commit review artifact for `codex/issue-022-integration-patterns`.

## Summary

Implemented installer lifecycle hardening for the agent integration layer:

- Added explicit integration tiers and failure modes for Claude Code, Codex, and OpenClaw.
- Added SHA-256 integrity metadata over Hookwire-managed config and Claude hook groups.
- Added `hookwire doctor` tamper detection for missing or mismatched managed integrity.
- Added `--no-patch` / `--patch-mode manual` so users can get manual patch instructions without file writes or backups.
- Added `hookwire uninstall` with dry-run/manual modes, backup creation before mutation, and Claude hook removal that preserves user hook groups.
- Documented agent integration tiers, failure modes, installer lifecycle behavior, and policy precedence.

## Claude Review Gate

First review command:

```sh
claude -p --settings /Users/mantiz/.claude/settings.local.json "Review this Hookwire issue 022 integration lifecycle/hook integrity implementation as a senior code reviewer. Issue: docs/issues/022-integration-lifecycle-and-hook-integrity.md. Changed files: packages/installer/src/installer.mjs, packages/installer/bin/hookwire.mjs, packages/agent-adapters/src/claude.mjs, tests/unit/installer-framework.test.mjs, tests/unit/claude-installer.test.mjs, tests/unit/verify-docs.test.mjs, scripts/proof-issue-022-integration-patterns.mjs, README.md, docs/architecture.md, docs/implementation-plan.md, docs/issues/README.md. Proof artifact: docs/reviews/2026-06-22-issue-022-integration-patterns-proof.json. Focus on hook integrity semantics, false tamper positives/negatives, uninstall safety, destructive-write prevention, and whether manual mode truly avoids writes. Lead with blocking/high-risk findings only; include file and line references. If none, say no blocking/high-risk findings."
```

Second review command:

```sh
claude -p "Review Hookwire issue 022 implementation. Files: packages/installer/src/installer.mjs, packages/installer/bin/hookwire.mjs, packages/agent-adapters/src/claude.mjs, scripts/proof-issue-022-integration-patterns.mjs, tests/unit/installer-framework.test.mjs. Issue: docs/issues/022-integration-lifecycle-and-hook-integrity.md. Focus only on blocking/high-risk findings: hook integrity false positives/negatives, uninstall safety, destructive-write prevention, manual mode avoiding writes. Include file:line refs. If none, say no blocking/high-risk findings."
```

Result:

> Claude review unavailable.

Both commands emitted only the local permission-rule warning `Permission deny rule "Dont read .env file" matches no known tool - check for typos.` and then hung without returning review findings. The first attempt was stopped after roughly two minutes; the second was stopped after roughly ninety seconds. Interrupting both sessions returned `Execution error`.

Disposition:

- No Claude findings were returned to disposition.
- A local manual review identified one integrity-classifier risk before commit: the initial SHA-256 payload collector accepted any `hookwire` command whose args merely included `--agent`, `claude`, `--event`, and the event name. That could hash a custom command as Hookwire-managed state. The implementation now requires the exact managed Claude hook arg layout, and a regression test covers a non-managed custom `hookwire` command with a different arg order.

## Verification

- `npx vitest run tests/unit/installer-framework.test.mjs tests/unit/claude-installer.test.mjs tests/unit/claude-adapter.test.mjs tests/unit/verify-docs.test.mjs --coverage.enabled=false`
- `npm run proof:issue022:integration-patterns`
- `npm run test:unit`
- `npm run web:lint`
- `npm run web:build`
- `npm run web:typecheck`
- `npm run test:e2e`

Observed results:

- Focused installer/Claude/docs suite: 61 tests passed.
- Issue proof: wrote `docs/reviews/2026-06-22-issue-022-integration-patterns-proof.json`.
- Unit suite: 124 tests passed, branch coverage 90.45%.
- Web lint: passed.
- Web build: passed.
- Web typecheck: passed.
- Web e2e: 25 tests passed.
