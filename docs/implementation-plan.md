# Implementation Plan: Hookwire

## Overview

Hookwire is an approval router for AI coding agents. The implementation should start with the web control plane and multiuser data model, then add secure local relay onboarding, agent installers, and external approval integrations.

The first runnable product should let a logged-in user onboard a project, register a local installation identity, create and review approval requests in the web inbox, approve or deny them, and inspect sessions and audit history.

## Linked Specification and Design Docs

- Product direction: [README.md](../README.md)
- Architecture: [architecture.md](architecture.md)
- Data model: [data-model.md](data-model.md)
- Issue backlog: [issues/README.md](issues/README.md)
- Verification standard: [verification.md](verification.md)

## Requirements Summary

### Functional Requirements

- Multiuser organization and project model.
- User onboarding flow that links user -> organization -> project -> agent tool -> local installation.
- Non-spoofable local relay identity using generated asymmetric keys.
- Web approval inbox as the first approval surface.
- Sessions view across Claude Code, Codex, and OpenClaw.
- Policy and rule configuration UI.
- Routes and integration configuration model that can represent Slack, SMS, Jira, Linear, email, GitHub, webhooks, local terminal, and web inbox.
- Audit trail for onboarding, sessions, approval requests, decisions, key registration, key rotation, and key revocation.
- Installer and local relay after the first web control plane milestone.

### Non-Functional Requirements

- **Security**: relay requests must be signed by non-revoked installation credentials; private keys never leave the local machine.
- **Privacy**: local relay redacts sensitive payloads before sending metadata upstream.
- **Availability**: safe local decisions should eventually work offline from cached policy.
- **Scalability**: data model supports many organizations, projects, users, installations, sessions, and approval routes.
- **Extensibility**: external integrations must use a provider-neutral delivery model.
- **Performance**: local safe allow/deny decisions must stay outside the backend hot path.

### Acceptance Criteria

- [ ] A user can create or join an organization.
- [ ] A user can create or connect a project.
- [ ] A user can select Claude Code, Codex, and OpenClaw as project tools.
- [ ] The CLI can generate a local keypair and register the public key.
- [ ] The backend can verify signed relay requests and reject spoofed or revoked credentials.
- [ ] A pending approval request can appear in the web inbox.
- [ ] A web user can approve or deny an approval request.
- [ ] Sessions, approvals, and decisions are visible in the web app.
- [ ] All relevant actions create audit events.
- [ ] External providers can be modeled before provider workers are implemented.

## Technical Approach

### Recommended Repository Shape

```text
apps/web/                Next.js app and API routes
packages/db/             Schema, migrations, typed database access
packages/domain/         Shared approval, policy, routing, and audit types
packages/crypto/         Request signing and verification helpers
cmd/hookwire/            CLI, installer, hook adapter, and local relay entrypoint
internal/relay/          Go relay implementation
internal/installer/      Agent detection and config patching
docs/                    Architecture, data model, issues, and implementation plan
```

The first milestone can create only the web/backend packages. The Go CLI and relay can be added once the API contract and key model are stable.

### Technology Stack

- Web/backend: Next.js with TypeScript.
- Database: Postgres.
- Migrations/query layer: Drizzle or Prisma. Choose one before implementation starts.
- Styling: Tailwind CSS or another project-local design system.
- Auth: Auth.js-compatible OAuth/email flow or managed auth behind an abstraction.
- Local relay/installer: Go.
- Event bus: not required for v1. NATS/JetStream can be added after provider workers create enough asynchronous workflow complexity.

### Key Design Decisions

1. **Web app first**: build the control plane before installer and relay details harden.
2. **Postgres as source of truth**: persistent canonical state belongs in the backend database.
3. **No NATS in v1**: design events cleanly, but start with direct DB-backed workflows.
4. **Cryptographic relay identity**: local installations sign requests with a private key; backend stores public keys and revocation state.
5. **Provider-neutral routing**: Slack is one adapter, not the approval system.
6. **Separate session owner from approver**: a session can be owned or claimed by one user, while approvals can be decided by another eligible user.

## Implementation Phases

### Phase 0: Product Foundation

Goal: establish the initial architecture, issue backlog, security model, and open-source contribution foundation.

Tasks:

- [x] [Project foundation and architecture docs](issues/001-project-foundation.md)
- [x] [User onboarding and session identity association](issues/019-user-onboarding-session-identity.md)
- [x] [Key-based relay authentication and revocation](issues/020-key-based-relay-authentication.md)
- [x] [GitHub Actions CI for public repository](issues/021-github-actions-ci.md)

Deliverables:

- Architecture and data model docs.
- Local issue backlog.
- Key-based relay identity design.
- Public-repo CI task and contribution verification plan.

Status: complete.

### Phase 1: Web Control Plane Foundation

Goal: create the first runnable web application with auth-ready tenancy and core navigation.

Tasks:

- [ ] Choose the web/db/auth stack.
- [ ] Scaffold `apps/web`.
- [ ] Scaffold database package and migration workflow.
- [ ] Implement organization, user, membership, project, and project membership tables.
- [ ] Implement app shell and navigation.
- [ ] Seed local development data.
- [ ] Add Docker Compose or equivalent local Postgres setup.

Related issues:

- [Multiuser database schema](issues/002-multiuser-database-schema.md)
- [Web app shell and navigation](issues/003-web-app-shell.md)

Deliverables:

- Running web app.
- Local database boot path.
- Basic organization/project navigation.

Estimated effort: 1-2 weeks.

### Phase 2: Onboarding and Relay Identity

Goal: make onboarding create real, revocable installation identity.

Tasks:

- [ ] Build web onboarding flow for organization/project/tool selection.
- [ ] Implement onboarding session/device-code model.
- [ ] Add backend endpoints for public key registration.
- [ ] Implement signing verification helpers.
- [ ] Implement credential revocation and rotation UI/API.
- [ ] Add audit events for key registration, rotation, and revocation.
- [ ] Add verification tests for invalid signatures, replayed nonces, stale timestamps, revoked credentials, and project mismatches.

Related issues:

- [User onboarding and session identity association](issues/019-user-onboarding-session-identity.md)
- [Key-based relay authentication and revocation](issues/020-key-based-relay-authentication.md)

Deliverables:

- Web onboarding flow.
- Backend key registration and verification API.
- Revocation-ready credential model.

Estimated effort: 1-2 weeks.

### Phase 3: Web Approval Inbox MVP

Goal: support the first end-to-end approval workflow entirely inside the web app.

Tasks:

- [ ] Implement approval request, delivery, decision, and audit tables.
- [ ] Implement approval request creation API for internal/dev use first.
- [ ] Build pending approval list.
- [ ] Build approval detail panel.
- [ ] Implement approve and deny actions.
- [ ] Record decisions and audit events transactionally.
- [ ] Add loading, empty, decided, expired, and unauthorized states.

Related issues:

- [Approval inbox MVP](issues/004-approval-inbox-mvp.md)
- [Approval decision API](issues/005-approval-decision-api.md)
- [Audit timeline](issues/009-audit-timeline.md)

Deliverables:

- User can approve or deny a pending request from the web app.
- Approval and decision are visible in audit history.

Estimated effort: 1-2 weeks.

### Phase 4: Sessions and Policy Configuration

Goal: expose the operational surfaces needed to understand agent behavior and configure routing rules.

Tasks:

- [ ] Implement agent tools, installations, sessions, session identities, and hook events.
- [ ] Build session explorer.
- [ ] Build policy list and rule editor.
- [ ] Build route and route target configuration.
- [ ] Connect policies to web inbox route targets.
- [ ] Add audit events for policy and route changes.

Related issues:

- [Session explorer](issues/006-session-explorer.md)
- [Policy and rule builder](issues/007-policy-rule-builder.md)
- [Route and integration configuration model](issues/008-route-integration-config.md)

Deliverables:

- Users can inspect sessions.
- Users can configure rules and routes.
- Web inbox is a configurable route target.

Estimated effort: 2 weeks.

### Phase 5: Relay-Facing API and Local Runtime

Goal: let a local Hookwire relay create signed approval requests and receive decisions.

Tasks:

- [x] Define relay API request and response contracts.
- [x] Implement signed approval request creation endpoint.
- [x] Implement decision polling or subscription endpoint.
- [ ] Implement local relay skeleton.
- [ ] Implement local policy cache format.
- [ ] Implement local redaction pipeline.
- [ ] Implement local audit queue.
- [x] Add end-to-end tests for signed relay -> approval request -> web decision -> relay decision retrieval.

Related issues:

- [Relay-facing approval request API](issues/010-relay-approval-api.md)
- [Local relay policy cache and evaluator](issues/015-local-relay-policy.md)
- [Local redaction pipeline](issues/016-local-redaction.md)

Deliverables:

- Local relay can authenticate with a key-backed installation credential.
- Local relay can create approval requests and retrieve decisions.

Estimated effort: 2-3 weeks.

### Phase 6: Installer and Agent Adapters

Goal: install Hookwire into Claude Code, Codex, and OpenClaw safely.

Tasks:

- [ ] Implement `hookwire init`.
- [ ] Detect Claude Code, Codex, and OpenClaw.
- [ ] Back up existing hook configs before mutation.
- [ ] Install hook adapter config.
- [ ] Implement `hookwire doctor`.
- [ ] Implement Claude adapter.
- [ ] Implement Codex adapter.
- [ ] Implement OpenClaw adapter.

Related issues:

- [Installer detection and config backup framework](issues/011-installer-framework.md)
- [Claude Code adapter](issues/012-claude-adapter.md)
- [Codex adapter](issues/013-codex-adapter.md)
- [OpenClaw adapter](issues/014-openclaw-adapter.md)

Deliverables:

- A user can run onboarding plus installer and route local agent approvals through Hookwire.

Estimated effort: 2-3 weeks.

### Phase 7: Integration Adapter Framework

Goal: add provider-neutral delivery infrastructure and implement Slack as the first external provider.

Tasks:

- [ ] Implement provider adapter interface.
- [ ] Implement approval delivery worker model.
- [ ] Add retry and timeout state.
- [ ] Add provider identity mappings.
- [ ] Implement Slack installation, delivery, and callback normalization.
- [ ] Keep web inbox as fallback.

Related issues:

- [Integration adapter framework](issues/017-integration-adapter-framework.md)
- [Slack integration adapter](issues/018-slack-integration.md)

Deliverables:

- Slack approvals work through the same canonical approval request and decision model as web approvals.

Estimated effort: 2-3 weeks.

## Dependencies

### External Dependencies

- Auth provider decision.
- Database ORM/migration decision.
- Exact Claude Code, Codex, and OpenClaw hook config formats.
- Slack app setup only when Phase 7 starts.

### Internal Dependencies

- Approval inbox depends on multiuser schema.
- Relay API depends on key-based installation credentials.
- Installer depends on relay API and hook adapter contracts.
- External integrations depend on canonical approval delivery records.

### Blockers

- Final choice of web/auth/db stack.
- OpenClaw hook/event contract if not already documented elsewhere.

## Risks and Mitigations

### Risk: Identity spoofing through local metadata

- Probability: medium.
- Impact: high.
- Mitigation: authorize relay requests only through verified asymmetric signatures and active installation credentials.

### Risk: Early architecture overbuild

- Probability: medium.
- Impact: medium.
- Mitigation: postpone NATS until integration workers require durable fan-out and retries.

### Risk: Agent hooks differ more than expected

- Probability: high.
- Impact: medium.
- Mitigation: define a strict canonical event envelope and keep adapters thin.

### Risk: Approval UI becomes too broad before core loop works

- Probability: medium.
- Impact: medium.
- Mitigation: ship web inbox first, then sessions/policies/routes, then integrations.

### Risk: Sensitive data leaks upstream

- Probability: medium.
- Impact: high.
- Mitigation: local redaction before backend submission, redacted payload contracts, and tests for secret-like inputs.

## Timeline

| Milestone | Target | Status |
| --- | --- | --- |
| Phase 0 complete | Now | Complete |
| Phase 1 complete | Week 1-2 | Planned |
| Phase 2 complete | Week 3-4 | Planned |
| Phase 3 complete | Week 5-6 | Planned |
| Phase 4 complete | Week 7-8 | Planned |
| Phase 5 complete | Week 9-11 | Planned |
| Phase 6 complete | Week 12-14 | Planned |
| Phase 7 complete | Week 15-17 | Planned |

## Success Criteria

### Technical Success

- [ ] Web approval inbox handles real approval requests.
- [ ] Sessions and approvals are queryable by organization, project, tool, and user.
- [ ] Relay identity is cryptographically verified.
- [ ] Credential revocation takes effect immediately.
- [ ] Local relay can operate safe local decisions without backend dependency.
- [ ] External provider approvals use canonical decisions.
- [ ] Audit trail covers all security-relevant changes.
- [ ] Every closed issue has proof artifacts satisfying its verification constraints.
- [ ] Every closed code-bearing, functional, runtime, or security-sensitive issue has a completed Claude review with findings resolved or dispositioned.

### Product Success

- [ ] A new user can onboard a project and see approval activity in the web app.
- [ ] Approval decisions are attributable to the correct human or integration identity.
- [ ] Teams can configure rules and routes without editing local files manually.
- [ ] Slack can be added without changing the core approval model.

## Progress Tracking

- Phase 0: Complete.
- Phase 1: Not started.
- Phase 2: Not started.
- Phase 3: Not started.
- Phase 4: Not started.
- Phase 5: Not started.
- Phase 6: Not started.
- Phase 7: Not started.

Latest update: 2026-06-18. Completed the GitHub Actions CI task for the public repository and marked Phase 0 complete.
