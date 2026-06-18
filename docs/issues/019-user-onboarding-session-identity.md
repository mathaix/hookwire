# User onboarding and session identity association

Labels: `type:feature`, `area:onboarding`, `area:web`, `area:backend`, `area:installer`, `priority:p0`

Milestone: M1

## Objective

Create the onboarding flow that associates a logged-in Hookwire user with an organization, project, agent tool, local installation, and future agent sessions.

## Scope

- Web onboarding for creating or joining an organization.
- Project creation or connection from repository metadata.
- Tool selection for Claude Code, Codex, and OpenClaw.
- Device-code or CLI login flow.
- Automatic public/private key generation for the local user/device.
- Public-key registration for relay installation identity.
- Request signing and revocation requirements for relay credentials.
- Installation registration tied to the onboarding user.
- Session attribution fields for started-by, claimed-by, and service-owned sessions.
- Audit events for session claim and ownership changes.

## Acceptance Criteria

- A logged-in user can create or join an organization.
- A logged-in user can create or connect a project.
- A logged-in user can select agent tools for the project.
- Local `hookwire login` or equivalent device-code flow links the CLI to the web user.
- The CLI generates an asymmetric keypair locally during onboarding.
- The private key never leaves the local machine.
- The backend stores only the public key, fingerprint, algorithm, and credential status.
- `hookwire init` registers an agent installation for the selected project/tool.
- Local relay credentials map incoming signed events to organization, project, tool, and installation.
- Relay API requests are signed with the installation private key.
- Backend verification rejects unsigned requests, invalid signatures, revoked keys, stale timestamps, and replayed nonces.
- A user or admin can revoke an installation credential from the web app.
- Revoked credentials cannot create sessions, create approval requests, sync audit events, or receive decisions.
- Key registration, rotation, and revocation create audit events.
- New sessions inherit project/tool/installation identity from the relay credential.
- Sessions can record `started_by_user_id` when known.
- Sessions can be manually claimed or reassigned with an audit trail.
- Approval decisions always record the approver separately from the session owner.

## Notes

The local relay should authenticate as an installation credential. It should not reuse the user's browser session or rely on spoofable user names from the local OS. This keeps local agent traffic cryptographically attributable and revocable while preserving a clear link to the user who performed onboarding.

Ed25519 is the recommended default key algorithm for v1.

## Verification Constraints

### Automated Checks

- Run onboarding tests for create organization, join organization, create project, select tools, create device-code session, register installation, and start session.
- Run tests proving sessions inherit organization, project, agent tool, and installation from verified relay credentials.
- Run tests for nullable `started_by_user_id`, manual claim, reassignment, and service-owned sessions.
- Run tests proving approval decisions record the approver separately from session owner and session claimant.

### Proof Artifacts

- Attach end-to-end onboarding test output with seeded user, project, tool, installation, and session ids.
- Attach screenshots of web onboarding states.
- Attach database query output showing user -> membership -> project membership -> tool -> installation -> session.
- Attach audit row output for session claim and reassignment.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on identity association, spoofing assumptions, owner vs approver separation, and onboarding recovery paths.
