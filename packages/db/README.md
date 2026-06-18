# Hookwire Database

This package owns the first Postgres schema for the Hookwire control plane.

## Local Setup

Start Postgres:

```sh
docker compose up -d postgres
```

Set the local connection string:

```sh
export DATABASE_URL=postgres://postgres:hookwire@127.0.0.1:54322/hookwire
```

Apply migrations:

```sh
npm run db:migrate
```

Reset and re-apply migrations during local development:

```sh
npm run db:reset
npm run db:migrate
```

`db:reset` drops the `public` and `hookwire` schemas and recreates the local `hookwire_app` database role. Run it only against a disposable development database, such as the Docker Compose service above.

## Schema Guarantees

- Every tenant-owned table carries `organization_id`.
- Cross-table references use same-organization foreign keys where tenant ownership can cross a parent boundary.
- The `hookwire_app` database role is isolated with row-level security policies based on `app.current_organization_id`.
- Request handlers must set `app.current_organization_id` with `SET LOCAL` inside a transaction, or `set_config('app.current_organization_id', value, true)`, before querying through `hookwire_app`. Do not set it as a session-level value on pooled connections.
- Agent tool checks include `claude`, `codex`, and `openclaw`.
- Route targets can represent `web_inbox`, `slack`, `sms`, `jira`, `linear`, `email`, `github`, `webhook`, and `local_terminal`.
- Integration rows can represent Slack, Twilio/SMS, Jira, Linear, GitHub, email, and webhook providers.
