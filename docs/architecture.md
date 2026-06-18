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

