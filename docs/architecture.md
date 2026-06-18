# Hookwire Architecture

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
  -> runs hookwire init for selected project/tools
  -> backend registers agent tool + machine installation
  -> installer writes local relay credentials and hook config
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
- A session inherits `organization_id`, `project_id`, `agent_tool_id`, and `agent_installation_id` from the installation credential used by the relay.
- A session can have a nullable `started_by_user_id`. For a solo developer this usually matches the installation owner. For shared machines, CI, or service accounts it can be null or point to a service identity.
- A decision always records the human or integration identity that approved or denied it. The approver is separate from the session owner.
- Manual claim or reassignment should be auditable when session ownership cannot be inferred confidently.

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
