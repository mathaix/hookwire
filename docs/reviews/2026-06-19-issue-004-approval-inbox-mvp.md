# Issue 004 Review: Approval Inbox MVP

Issue: [004-approval-inbox-mvp.md](../issues/004-approval-inbox-mvp.md)

Scope: implement the first web-only approval inbox with pending request review, redacted detail inspection, approve-once and deny decisions, required denial reason handling, completed/expired/unauthorized/empty/loading states, audit event creation, and proof artifacts.

## Changed Files

- `apps/web/app/approvals/approval-inbox.tsx`
- `apps/web/app/approvals/domain.ts`
- `apps/web/app/globals.css`
- `apps/web/app/page.tsx`
- `package.json`
- `scripts/proof-issue-004-db.mjs`
- `tests/e2e/approval-inbox.spec.ts`
- `tests/e2e/web-shell.spec.ts`
- `tests/unit/approval-inbox.test.ts`
- `vitest.config.ts`
- `docs/reviews/2026-06-19-issue-004-approved.png`
- `docs/reviews/2026-06-19-issue-004-db-query-output.json`
- `docs/reviews/2026-06-19-issue-004-denied.png`
- `docs/reviews/2026-06-19-issue-004-empty.png`
- `docs/reviews/2026-06-19-issue-004-pending-detail.png`

## Tests-First Evidence

The unit and e2e tests were added before the approval domain module and interactive inbox existed.

Initial failing command:

```sh
npx vitest run tests/unit/approval-inbox.test.ts --coverage.enabled=false
```

Initial failure:

```text
Error: Cannot find module '../../apps/web/app/approvals/domain'
```

## Verification Commands

```sh
npm run web:lint
```

Result:

```json
{
  "ok": true,
  "routes": 7
}
```

```sh
npm run web:typecheck
```

Result: passed.

```sh
npm run web:build
```

Result:

```text
Compiled successfully.
Routes generated: /, /audit, /integrations, /policies, /routes, /sessions, /settings
```

```sh
npm run test:unit
```

Result:

```text
3 passed.
30 tests passed.
Coverage summary:
Statements: 99.55%
Branches: 97.9%
Functions: 100%
Lines: 99.53%
```

```sh
npm run test:e2e
```

Result:

```text
13 passed.
```

## Seeded Request IDs

Browser fixtures:

- `APR-1042`: pending high-risk approval, approved in e2e and screenshot proof.
- `APR-1041`: pending medium-risk approval requiring denial reason, denied in e2e and screenshot proof.
- `APR-1039`: expired critical approval, verified as non-decidable in e2e.

Database proof seed IDs are in [2026-06-19-issue-004-db-query-output.json](2026-06-19-issue-004-db-query-output.json).

## Screenshot Proof

- Pending list and detail panel: [2026-06-19-issue-004-pending-detail.png](2026-06-19-issue-004-pending-detail.png)
- Approved state: [2026-06-19-issue-004-approved.png](2026-06-19-issue-004-approved.png)
- Denied state: [2026-06-19-issue-004-denied.png](2026-06-19-issue-004-denied.png)
- Empty state: [2026-06-19-issue-004-empty.png](2026-06-19-issue-004-empty.png)

Screenshot capture evidence:

```json
{
  "title": "Hookwire",
  "approvedStatus": "Approved",
  "deniedStatus": "Denied",
  "emptyState": true,
  "consoleMessages": []
}
```

The in-app browser connected and rendered the app, but its screenshot capture timed out. Screenshot artifacts were captured with Playwright Chromium, matching the project e2e toolchain.

```sh
npm run proof:issue004:db
```

Result: passed and regenerated [2026-06-19-issue-004-db-query-output.json](2026-06-19-issue-004-db-query-output.json).

## Database Query Proof

The artifact [2026-06-19-issue-004-db-query-output.json](2026-06-19-issue-004-db-query-output.json) was generated from a disposable Postgres 16 container after running the repository migration runner. It includes queried rows from:

- `approval_requests`
- `approval_decisions`
- `audit_events`

The queried rows show:

- `APR-1042` request status updated to `approved`.
- A matching `approval_decisions` row with `decision: approved`, `scope: once`, and `source: web`.
- A matching `audit_events` row with `event_type: approval.approved`.
- `APR-1041` request status updated to `denied`.
- A matching `approval_decisions` row with `decision: denied`, `scope: once`, `source: web`, and the denial reason.
- A matching `audit_events` row with `event_type: approval.denied` and `reasonRequired: true`.

## Acceptance Criteria Mapping

- A user can see pending approval requests: `tests/e2e/approval-inbox.spec.ts` asserts `APR-1042` and `APR-1041` render in the approval inbox table.
- A user can inspect redacted request details: the detail panel renders risk, policy, project, agent, route, session, requester, and redacted payload metadata.
- A user can approve or deny from the web app: e2e clicks approve and deny actions and asserts rendered state changes.
- The decision updates request status: unit tests assert reducer status changes exactly once; e2e asserts the visible status pills update to `Approved` and `Denied`.
- The decision is recorded as an audit event: unit tests assert audit creation in the same reducer transition; e2e asserts `approval.approved` and `approval.denied` appear once in audit activity.
- Reason input where required: unit and e2e tests assert `APR-1041` denial is blocked until a reason is provided.
- Empty, loading, completed, expired, and unauthorized states: covered by `approval-inbox.spec.ts`.
- Redaction: unit tests assert known secret fixture values are removed by `redactPayload`; e2e asserts `sk-live-super-secret` is never rendered.

## Notes

- Issue 004 remains web-only. The UI uses a local domain reducer so issue 005 can wire the same approval request, decision, and audit semantics into a server API.
- The proof database rows were generated independently against the schema to validate the target persistence shape before the API implementation exists.

## Claude Review

Review command:

```sh
git diff --cached | claude -p "Review this Hookwire issue 004 implementation as a senior code reviewer..."
```

Claude emitted a local configuration warning before review:

```text
Permission deny rule "Dont read .env file" matches no known tool — check for typos.
```

Claude review result:

```text
High:
1. Database proof artifact is not reproducible from the branch.

Medium:
2. Redaction tests mask gaps for connection strings, JWTs, AWS keys, and password query strings.
3. Row selection remains pinned when a `?select=` URL param is present.
```

Disposition:

- Added `scripts/proof-issue-004-db.mjs` and `npm run proof:issue004:db`, then regenerated the DB query artifact through the committed command.
- Hardened `redactPayload` for bearer/basic credentials, URL credentials, password/token query strings, JWT-shaped values, AWS access keys, `sk-...`, and GitHub token forms.
- Added unit assertions proving those additional secret forms are removed.
- Changed URL preselection to initialize inbox state instead of permanently overriding local row selection.
- Added a Playwright regression for clicking `APR-1041` after loading `/?select=APR-1042`.
- Reran Claude review after those fixes. The second review found no hard functional blockers, but flagged two redaction weaknesses:
  - Sensitive keys holding objects or arrays were not redacted as a full subtree.
  - The e2e redaction assertion was vacuous because no rendered fixture contained `sk-live-super-secret`.
- Fixed sensitive-key subtree redaction, seeded `sk-live-super-secret` into the pre-redacted browser fixture, and added e2e assertions proving both the token and database password are not rendered.
- Added unit fixtures for nested credential objects, secret arrays, connection strings, JWTs, AWS access keys, and password query strings.
- Documented why Docker-backed proof scripts are verified by explicit proof commands rather than unit coverage.
- Reran targeted unit/e2e checks after fixes, then reran the full verification suite.

Final Claude review result:

```text
Verdict: No blocking or high-risk findings remain.

Prior findings verified resolved:
1. Reproducible DB proof.
2. Sensitive-key subtree redaction.
3. Non-vacuous e2e redaction assertion with a seeded secret.
4. Row selection with `?select=`.
```
