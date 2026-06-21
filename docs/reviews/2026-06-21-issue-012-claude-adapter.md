# Issue 012: Claude Code Adapter Review

Issue: [Claude Code adapter](../issues/012-claude-adapter.md)

Proof artifact: [2026-06-21-issue-012-claude-adapter-proof.json](2026-06-21-issue-012-claude-adapter-proof.json)

Reference: [Claude Code hooks documentation](https://code.claude.com/docs/en/hooks)

## Summary

Implemented the Claude Code adapter and installer wiring:

- `hookwire hook --agent claude --event <event>` reads Claude hook JSON from stdin and emits Claude-compatible JSON on stdout.
- Claude `PreToolUse`, `PermissionRequest`, and `PostToolUse` payloads normalize into a Hookwire event envelope.
- `allow`, `deny`, and `ask` decisions map to Claude hook output shapes, including top-level PostToolUse blocking.
- The installer writes exec-form Claude Code hooks, preserves user hook groups, backs up existing settings, and lets `hookwire doctor` detect hook drift.
- Malformed PreToolUse and PermissionRequest payloads fail closed; malformed PostToolUse payloads return a non-blocking system message because the tool has already run.

## Claude Review Gate

Final review command:

```sh
claude -p --settings /Users/mantiz/.claude/settings.local.json "Re-review only these Hookwire issue 012 files after the hardening patch: packages/agent-adapters/src/claude.mjs, packages/installer/src/installer.mjs, packages/installer/bin/hookwire.mjs, tests/unit/claude-adapter.test.mjs, tests/unit/claude-installer.test.mjs, scripts/proof-issue-012-claude-adapter.mjs. Focus on blocking/high-risk problems in Claude hook compatibility, fail-closed behavior, installer config generation, and golden outputs. Assume current Claude Code hook docs support command args/statusMessage, PermissionRequest, PreToolUse permissionDecision/updatedInput/additionalContext, and PostToolUse top-level decision/reason. Lead with blocking or high-risk findings only; include file and line references. If none, say no blocking/high-risk findings."
```

Final verdict:

> No blocking or high-risk findings.

The review confirmed fail-closed behavior for malformed payloads and invalid runtime decisions, Claude-compatible output shapes for all three implemented events, safe installer mutation order, idempotent hook merging, doctor drift detection, and proof-script consistency.

Low-risk notes and disposition:

- Unsupported non-Claude `--agent` returns exit 1 instead of deny JSON. Deferred because this adapter is Claude-specific and the installer hardcodes `--agent claude`; unsupported agents should not be silently treated as Claude hook events.
- Malformed PostToolUse returns `systemMessage` instead of blocking. Accepted because PostToolUse runs after the tool completes; the adapter records/reporting failure without claiming pre-execution enforcement.
- Proof `generatedAt` uses live time. Accepted because the JSON is an evidence artifact, not a byte-for-byte CI golden.

An earlier review pass used stale assumptions and incorrectly reported `args`, `statusMessage`, and `PermissionRequest` as unsupported. These were dispositioned as false positives against the current Claude Code hooks documentation.

## Verification

- `npx vitest run tests/unit/claude-adapter.test.mjs tests/unit/claude-installer.test.mjs tests/unit/installer-framework.test.mjs --coverage.enabled=false`
- `npm run proof:issue012:claude`
- `npm run test:unit`
- `npm run web:lint`
- `npm run web:build`
- `npm run web:typecheck`
- `npm run test:e2e`
- `git diff --check`

Final observed results:

- Focused Claude/installer suite: 32 tests passed.
- Unit suite: 117 tests passed, branch coverage above the 90% threshold.
- Issue proof: wrote `docs/reviews/2026-06-21-issue-012-claude-adapter-proof.json`.
- Web e2e: 25 tests passed.
