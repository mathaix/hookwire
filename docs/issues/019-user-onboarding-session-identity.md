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
- Installation registration tied to the onboarding user.
- Session attribution fields for started-by, claimed-by, and service-owned sessions.
- Audit events for session claim and ownership changes.

## Acceptance Criteria

- A logged-in user can create or join an organization.
- A logged-in user can create or connect a project.
- A logged-in user can select agent tools for the project.
- Local `hookwire login` or equivalent device-code flow links the CLI to the web user.
- `hookwire init` registers an agent installation for the selected project/tool.
- Local relay credentials map incoming events to organization, project, tool, and installation.
- New sessions inherit project/tool/installation identity from the relay credential.
- Sessions can record `started_by_user_id` when known.
- Sessions can be manually claimed or reassigned with an audit trail.
- Approval decisions always record the approver separately from the session owner.

## Notes

The local relay should authenticate as an installation credential. It should not reuse the user's browser session. This keeps local agent traffic auditable and revocable while preserving a clear link to the user who performed onboarding.

