# Issue 002 Review: Multiuser Database Schema

Issue: [002-multiuser-database-schema.md](../issues/002-multiuser-database-schema.md)

Scope: implement the first Postgres schema, migration runner, local database workflow, and tenant isolation tests for Hookwire's multiuser control plane.

## Changed Files

- `compose.yaml`
- `README.md`
- `docs/data-model.md`
- `docs/schema/issue-002-schema-snapshot.md`
- `package.json`
- `package-lock.json`
- `packages/db/README.md`
- `packages/db/migrations/0001_initial_schema.sql`
- `packages/db/src/migrate.mjs`
- `tests/unit/db-schema.test.mjs`

## Tests-First Evidence

The unit tests were added before `packages/db/src/migrate.mjs` and the migration existed.

Initial failing command:

```sh
npm run test:unit
```

Initial failure:

```text
Error: Cannot find module '../../packages/db/src/migrate.mjs' imported from tests/unit/db-schema.test.mjs
```

## Migration Proof

Temporary proof database:

```text
postgres:16 container
DATABASE_URL=postgres://postgres:hookwire@127.0.0.1:62374/hookwire_test
```

Reset:

```sh
DATABASE_URL=postgres://postgres:hookwire@127.0.0.1:62374/hookwire_test npm run db:reset
```

Result:

```json
{
  "reset": true
}
```

Clean migration:

```sh
DATABASE_URL=postgres://postgres:hookwire@127.0.0.1:62374/hookwire_test npm run db:migrate
```

Result:

```json
{
  "applied": [
    "0001_initial_schema.sql"
  ]
}
```

Repeat migration:

```sh
DATABASE_URL=postgres://postgres:hookwire@127.0.0.1:62374/hookwire_test npm run db:migrate
```

Result:

```json
{
  "applied": []
}
```

## Schema Snapshot

Schema artifact: [issue-002-schema-snapshot.md](../schema/issue-002-schema-snapshot.md)

The snapshot includes:

- 29 base tables including `schema_migrations`.
- Same-organization foreign keys for project, session, route, integration, approval, and audit relations.
- Check constraints for `claude`, `codex`, and `openclaw`.
- Check constraints for web inbox, Slack, SMS/Twilio, Jira, Linear, GitHub, email, webhook, and local terminal route or integration targets.
- Row-level security policies for the `hookwire_app` application role, including select-only policies for `organizations` and `users`.
- Index summary for core tenant and workflow query paths.

Final global-table RLS and grant proof:

```text
organizations | organizations_tenant_select | SELECT | id = hookwire.current_organization_id()
users | users_tenant_select | SELECT | membership exists for hookwire.current_organization_id()
hookwire_app | organizations | SELECT
hookwire_app | users | SELECT
schema_migrations | hookwire_app access denied
```

Final installation revocation proof:

```text
agent_installations_revoked_by_same_org_fk | FOREIGN KEY (organization_id, revoked_by_user_id) REFERENCES memberships(organization_id, user_id)
agent_installations_revoked_state_check | CHECK status <> revoked OR revoked_at IS NOT NULL
```

## Verification Commands

```sh
npm run test:unit
```

Result:

```text
Test Files  2 passed (2)
Tests  25 passed (25)
Coverage summary:
Statements: 100%
Branches: 96.51%
Functions: 100%
Lines: 100%
```

The `multiuser database schema` test suite covers:

- clean migration plus reset/re-apply repeatability;
- required table list;
- required foreign keys, uniqueness constraints, non-null fields, and check constraints;
- row-level security isolation for organizations, users, projects, sessions, approvals, routes, route targets, integrations, and audit events;
- blocked cross-tenant writes through the `hookwire_app` role.

## Acceptance Criteria Mapping

- Schema supports multiple organizations: `organizations` plus `organization_id` on tenant-owned tables and RLS policies.
- Schema supports multiple users per organization with roles: `users`, `memberships`, `project_memberships`, role/status checks, and uniqueness constraints.
- Schema supports Claude, Codex, and OpenClaw installations: `agent_tools` and `agent_installations` check constraints.
- Schema supports web inbox approvals without Slack: `route_targets.target_type = web_inbox`, approval request/delivery/decision tables, and audit events.
- Schema can represent Slack, SMS, Jira, Linear, GitHub, email, and webhook targets: route target and integration provider checks.
- Migrations are repeatable in local development: `db:reset`, first `db:migrate`, and second no-op `db:migrate` proof above.

## Claude Review

Review command:

```sh
git diff --cached | claude -p "Review this Hookwire issue implementation as a senior code reviewer..."
```

Claude emitted a local configuration warning before review:

```text
Permission deny rule "Dont read .env file" matches no known tool — check for typos.
```

Claude findings:

```text
Verdict: No build-breaking defect.

HIGH:
1. organizations and users have no RLS but full DML is granted to hookwire_app.

MEDIUM:
2. Isolation is proven for only 6 of 26 RLS tables; mutation proven for only 5.
3. Session-level GUC pattern set_config(..., false) will leak across pooled connections.
4. RLS is not FORCEd; relies on hookwire_app never owning the tables.
5. agent_installations is revocable but has no revoked_at / revoked_by_user_id.

LOW:
6. resetDatabase drops a cluster-global role and the public schema.
7. approval_decisions uniqueness allows duplicate NULL-user decisions.
8. Provider/target naming split and pgcrypto use are residual cleanup risks.
```

Disposition:

- Fixed the high finding by adding RLS to `organizations` and `users`, revoking insert/update/delete on both tables from `hookwire_app`, and adding tests proving org A cannot read org B's organization row or unrelated users.
- Expanded tenant-isolation tests to cover approval deliveries, approval decisions, route targets, audit event mutation, cross-tenant deletes, and global-table mutation denial.
- Changed the app-role test path and documentation to use transaction-local `set_config(..., true)` / `SET LOCAL` semantics instead of session-level tenant context.
- Added `force row level security` for all tenant RLS tables and for `organizations` / `users`.
- Added `revoked_at`, `revoked_by_user_id`, `revocation_reason`, a same-org revoker FK, and revoked-state check to `agent_installations`.
- Documented that `db:reset` is destructive and should only run against disposable development databases.
- Deferred duplicate NULL-user decision semantics until the approval decision API defines integration/system idempotency keys.
- Deferred provider token normalization and possible `pgcrypto` removal until route/integration worker implementation chooses canonical provider identifiers and production migration privileges.
- Fixed the final low-risk migration-ledger hardening note by revoking all `schema_migrations` privileges from `hookwire_app` and adding a denial assertion to the tenant isolation test.

## Final Claude Review

Final narrow review command:

```sh
git diff --cached | claude -p "Final narrow review for Hookwire issue 002 after the prior no-blocker review..."
```

Final result:

```text
No blockers. The schema_migrations revoke and the test expectation are both correct.

Revoke correctness:
- schema_migrations is created before the migration body runs.
- grant-then-revoke ordering is correct.
- hookwire_app SELECT fails with permission denied.
- migrate() still runs as the DATABASE_URL role, so repeatability is not impaired.

Test expectation correctness:
- selecting schema_migrations under set role hookwire_app correctly rejects on permission denied.
- the savepoint helper prevents the expected error from poisoning the surrounding transaction.

No invalidation of the prior review:
- the change is purely additive hardening on a ledger table.
- it does not touch tenant RLS, same-org FKs, or tenant table app-role grants.
```
