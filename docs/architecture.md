# Hookwire Architecture

Rendered Mermaid diagrams for the architecture and main approval sequences live in [diagrams.md](diagrams.md).

## Components

### Web Control Plane

The web control plane is the first implementation target.

Responsibilities:

- Configure policies, rules, routes, and integration targets.
- Show pending approval requests.
- Show agent sessions across projects and users.
- Record approval decisions.
- Show audit history.
- Manage organizations, projects, users, groups, and on-call ownership.

### Backend API

Responsibilities:

- Persist canonical records in Postgres.
- Own the onboarding flow that links users, projects, agent tools, installations, and sessions.
- Accept approval requests from local relays.
- Resolve route eligibility and approval options.
- Accept decisions from web or integration callbacks.
- Expose sessions, policies, integrations, audit events, and admin configuration.

### Local Relay

Responsibilities:

- Receive hook events from agent adapters.
- Normalize agent-specific event payloads.
- Apply cached local policy.
- Auto-allow safe actions and deny forbidden actions in the local hot path.
- Redact sensitive data before sending upstream.
- Queue local audit events for sync.
- Ask the backend for routed approval only when local policy requires it.

### Installer

Responsibilities:

- Install or locate the Hookwire binary.
- Detect Claude Code, Codex, and OpenClaw.
- Back up existing agent hook configuration.
- Register Hookwire hook adapter commands.
- Create default local policy and relay config.
- Validate the integration with a sample event.

### Integration Workers

Integrations should be provider adapters behind a common approval delivery model.

Target providers:

- Web inbox
- Slack
- SMS/text
- Jira
- Linear
- Email
- GitHub
- Generic webhook
- Local terminal

## Storage

### Local Machine

- Local relay config
- Locally generated private keys for registered relay installations
- Cached policy bundle
- Local session cache
- Local audit queue
- Optional SQLite or append-only JSONL

### Backend

- Postgres for canonical state
- Object storage later if full artifacts or exports are needed

### Event Bus

NATS is optional for v1.

V1 can use Postgres-backed state transitions and simple background workers. NATS/JetStream becomes useful when Hookwire has multiple integration workers, durable retries, fan-out, delayed escalations, and event replay needs.

## User Onboarding and Identity Association

Hookwire should not infer human ownership only from agent event payloads. The logged-in user is associated to project, tool, and session during onboarding and relay registration.

### Onboarding Flow

```text
User signs in to Hookwire web
  -> creates or joins organization
  -> creates or connects project
  -> chooses supported tools: Claude Code, Codex, OpenClaw
  -> runs hookwire login or device-code login locally
  -> Hookwire CLI generates a local public/private keypair
  -> runs hookwire init for selected project/tools
  -> backend registers agent tool + machine installation + public key
  -> installer stores the private key locally and writes hook config
  -> each session created by that relay is linked back to the installation, project, tool, organization, and onboarding user
```

### Association Chain

The canonical chain is:

```text
users
  -> memberships
  -> project_memberships
  -> agent_tools
  -> agent_installations
  -> agent_sessions
  -> hook_events
  -> approval_requests
  -> approval_decisions
```

### Identity Rules

- The web app authenticates people.
- The local relay authenticates as an `agent_installation`, not as a browser session.
- An installation is registered by a logged-in user during onboarding.
- Relay identity must be cryptographic and non-spoofable. A relay request is trusted only when it is signed by a non-revoked private key whose public key is registered to that installation.
- A session inherits `organization_id`, `project_id`, `agent_tool_id`, and `agent_installation_id` from the installation credential used by the relay.
- A session can have a nullable `started_by_user_id`. For a solo developer this usually matches the installation owner. For shared machines, CI, or service accounts it can be null or point to a service identity.
- A decision always records the human or integration identity that approved or denied it. The approver is separate from the session owner.
- Manual claim or reassignment should be auditable when session ownership cannot be inferred confidently.

### Key-Based Relay Authentication

Each local installation should generate an asymmetric keypair automatically during onboarding. Ed25519 is a good default for v1 because signatures are small, fast, and widely supported.

Rules:

- The private key is generated locally and never sent to Hookwire.
- The public key is registered with the backend through a logged-in user onboarding session.
- The backend stores the public key, key fingerprint, algorithm, installation, project, organization, registering user, and revocation status.
- Every relay API request includes a key id, timestamp, nonce, body hash, and signature over the request context.
- The backend verifies the signature, rejects stale timestamps, rejects replayed nonces, and checks that the key and installation are active.
- Revoking a key immediately prevents that relay from creating sessions, creating approval requests, syncing audit events, or receiving decisions.
- Key registration, rotation, and revocation are audit events.
- Key rotation should create a new key before revoking the old one so the installer can recover cleanly.

The v1 relay approval API exposes:

- `POST /api/relay/approvals` to create a pending approval request from a redacted hook-event envelope.
- `GET /api/relay/approvals/{approvalRequestId}/decision` to poll for `pending`, `approved`, `denied`, or `expired`.

Each request must include:

- `x-hookwire-key-id`
- `x-hookwire-timestamp`
- `x-hookwire-nonce`
- `x-hookwire-body-sha256`
- `x-hookwire-signature`

The Ed25519 signature is computed over this canonical string:

```text
hookwire-relay-v1
METHOD
PATH
KEY_ID
TIMESTAMP
NONCE
BODY_SHA256
```

The body still carries `projectId`, `agentInstallationId`, `agentSessionId`, and `routeId`; the backend verifies those values against the registered credential instead of trusting them as authority.

## V1 Approval Flow

```text
Agent runtime
  -> Hookwire hook adapter
  -> Local relay
  -> Backend HTTP API when approval is required
  -> Postgres approval request
  -> Web approval inbox
  -> Web user approves or denies
  -> Backend records decision
  -> Local relay receives decision
  -> Agent proceeds or stops
```

## Future NATS Flow

```text
Backend API writes Postgres transaction
  -> publishes approval.created
  -> web notifier updates live inbox
  -> Slack/SMS/Jira/Linear workers deliver requests
  -> timeout worker schedules escalation
  -> audit worker appends normalized event
```
