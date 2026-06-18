# Hookwire Issue Backlog

This backlog is written as GitHub-ready issue specs. Local files remain the source of truth until matching GitHub issues are created in the public repository.

## Milestones

- M0: Product foundation
- M1: Web approval control plane
- M2: Installer and local runtime
- M3: Integration delivery framework
- M4: Hosted operations and launch readiness

## Labels

- `area:web`
- `area:backend`
- `area:data-model`
- `area:installer`
- `area:local-relay`
- `area:agent-adapter`
- `area:integration`
- `area:audit`
- `area:security`
- `area:onboarding`
- `area:ci`
- `area:docs`
- `type:feature`
- `type:design`
- `type:infra`
- `priority:p0`
- `priority:p1`
- `priority:p2`

## Issues

1. [Project foundation and architecture docs](001-project-foundation.md)
2. [Multiuser database schema](002-multiuser-database-schema.md)
3. [Web app shell and navigation](003-web-app-shell.md)
4. [Approval inbox MVP](004-approval-inbox-mvp.md)
5. [Approval decision API](005-approval-decision-api.md)
6. [Session explorer](006-session-explorer.md)
7. [Policy and rule builder](007-policy-rule-builder.md)
8. [Route and integration configuration model](008-route-integration-config.md)
9. [Audit timeline](009-audit-timeline.md)
10. [Relay-facing approval request API](010-relay-approval-api.md)
11. [Installer detection and config backup framework](011-installer-framework.md)
12. [Claude Code adapter](012-claude-adapter.md)
13. [Codex adapter](013-codex-adapter.md)
14. [OpenClaw adapter](014-openclaw-adapter.md)
15. [Local relay policy cache and evaluator](015-local-relay-policy.md)
16. [Local redaction pipeline](016-local-redaction.md)
17. [Integration adapter framework](017-integration-adapter-framework.md)
18. [Slack integration adapter](018-slack-integration.md)
19. [User onboarding and session identity association](019-user-onboarding-session-identity.md)
20. [Key-based relay authentication and revocation](020-key-based-relay-authentication.md)
21. [GitHub Actions CI for public repository](021-github-actions-ci.md)

## Verification

Every issue includes verification constraints. Code-bearing, functional, runtime, and security-sensitive issues also require the shared [Claude review gate](../verification.md#claude-review-gate). Documentation-only issues follow the shared [verification standard](../verification.md) and use Claude review when explicitly called for or when the docs affect security posture, public API promises, or implementation decisions.
