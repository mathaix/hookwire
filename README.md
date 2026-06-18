# Hookwire

Hookwire is an open-source approval router for AI coding agents.

It is designed to sit between agent runtimes such as Claude Code, Codex, OpenClaw, Cursor, and future MCP-enabled tools. Hookwire receives tool-use and permission events, applies policy, routes risky actions to the right approval surface, and keeps an auditable trail of every decision.

## Product Shape

Hookwire has three major surfaces:

- Web control plane: configure rules, review approvals, inspect sessions, manage integrations, and audit decisions.
- Local runtime: relay, hook adapter, policy cache, redaction, and local audit queue.
- Installer: detects and configures Claude Code, Codex, and OpenClaw hook integrations.

The first runnable milestone is the web app itself. Slack, SMS, Jira, Linear, email, GitHub, and webhook approvals should be represented in the routing and integration model, but the first delivery path can be the Hookwire web inbox.

## Architecture Decisions

- Postgres is the source of truth for the hosted or self-hosted control plane.
- Local machines should not require Postgres.
- The local relay should make safe allow/deny decisions from cached policy without depending on the hosted backend.
- NATS/JetStream is not required for v1. It is a good future addition for integration workers, durable fan-out, retries, timeouts, and escalation workflows.
- The data model should support multiuser teams from day one, including approval groups, on-call assignment, and provider identity mappings.

## Repo Planning

Architecture details live in [docs/architecture.md](docs/architecture.md).
The multiuser data model lives in [docs/data-model.md](docs/data-model.md).
The initial implementation backlog lives in [docs/issues](docs/issues/README.md).
The sequenced implementation plan lives in [docs/implementation-plan.md](docs/implementation-plan.md).
The verification and Claude review standard lives in [docs/verification.md](docs/verification.md).
Local review artifacts can be stored under [docs/reviews](docs/reviews/README.md) until a PR system is connected.

## Open Source Readiness

Hookwire is intended to be developed in public. Contributor-facing setup, verification, and architecture docs should be updated alongside functional changes. The GitHub Actions CI task, including `main` branch protection against direct writes, is tracked in [docs/issues/021-github-actions-ci.md](docs/issues/021-github-actions-ci.md).
