# Issue 003 Review: Web App Shell and Navigation

Issue: [003-web-app-shell.md](../issues/003-web-app-shell.md)

Scope: implement the first Hookwire web control plane shell with stable navigation, organization/project switchers, an auth-ready user menu placeholder, dense approval dashboard content, and responsive mobile approval review.

## Changed Files

- `README.md`
- `apps/web/app/app-shell.tsx`
- `apps/web/app/audit/page.tsx`
- `apps/web/app/data.ts`
- `apps/web/app/globals.css`
- `apps/web/app/integrations/page.tsx`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/policies/page.tsx`
- `apps/web/app/routes/page.tsx`
- `apps/web/app/section-page.tsx`
- `apps/web/app/sessions/page.tsx`
- `apps/web/app/settings/page.tsx`
- `apps/web/lint.mjs`
- `apps/web/next-env.d.ts`
- `apps/web/next.config.mjs`
- `apps/web/tsconfig.json`
- `package.json`
- `package-lock.json`
- `playwright.config.ts`
- `tests/e2e/web-shell.spec.ts`

## Tests-First Evidence

The Playwright route and responsive tests were added before the web app scripts and implementation existed.

Initial failing command:

```sh
npm run test:e2e
```

Initial failure:

```text
[WebServer] npm error Missing script: "web:dev"
Error: Process from config.webServer was not able to start. Exit code: 1
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
npm run test:e2e
```

Result:

```text
7 passed
```

```sh
npm run test:unit
```

Result:

```text
25 passed.
Coverage summary:
Statements: 100%
Branches: 96.51%
Functions: 100%
Lines: 100%
```

```sh
npm run verify:docs
```

Result: `ok: true`.

```sh
git diff --check
```

Result: passed.

## Screenshot Proof

- Desktop: [2026-06-18-issue-003-desktop.png](2026-06-18-issue-003-desktop.png)
- Mobile: [2026-06-18-issue-003-mobile.png](2026-06-18-issue-003-mobile.png)

## Acceptance Criteria Mapping

- First screen is operational dashboard, not marketing: root route renders `Pending approvals`, a pending approval table, selected approval detail, session activity, route health, and audit activity. Playwright asserts no `Get started with Hookwire` marketing copy.
- Navigation is stable across main sections: Playwright visits Inbox, Sessions, Policies, Routes, Integrations, Audit, and Settings and asserts the active `aria-current` navigation state.
- Layout supports dense approval and session data: desktop Playwright test asserts the grid shell, approval list, detail panel, session activity, and route health regions.
- Mobile layout remains usable for approval review: mobile Playwright test asserts horizontal primary navigation, approval list, detail panel, and approve/deny actions.
- Dense section tables remain usable on mobile: Playwright asserts the Sessions table is inside a horizontal scroll wrapper.

## Design Verification Notes

- Generated a restrained operational dashboard concept with left nav, top switchers, approval queue, detail panel, and bottom operational panels. The built-in image tool did not expose a reusable filesystem path in this environment, so the committed proof relies on rendered implementation screenshots.
- Desktop screenshot matches the intended dense operational model: fixed dark primary navigation, compact switchers, table-first approval queue, right-side decision panel, and secondary operational panels.
- Mobile screenshot keeps the primary nav scrollable, preserves organization/project/user controls, and keeps the approval queue plus detail panel reachable in a single-column flow.
- Above-the-fold copy is product UI only: `Hookwire`, route names, switchers, `Pending approvals`, approval table headings, and approve/deny actions.

## Claude Review

Review command:

```sh
git diff --cached | claude -p "Review this Hookwire issue implementation as a senior code reviewer..."
```

Claude emitted a local configuration warning before review:

```text
Permission deny rule "Dont read .env file" matches no known tool — check for typos.
```

Claude review result:

```text
Verdict: No blocking findings.

Medium:
1. Build artifact committed to version control: apps/web/tsconfig.tsbuildinfo.
2. Section-page data tables have no horizontal-scroll wrapper.

Low:
3. banner landmark nested inside main.
4. Marketing-drift guard is brittle.
5. Unnecessary !important.
```

Disposition:

- Removed `apps/web/tsconfig.tsbuildinfo` from the staged commit and added `*.tsbuildinfo` to `.gitignore`.
- Added a failing mobile regression test for dedicated section table scroll wrappers, then wrapped Sessions, Policies, Routes, and Integrations tables in `.table-wrap`.
- Removed the nested `role="banner"` and changed e2e assertions to target the topbar by test id.
- Kept the lint denylist as a tripwire while relying on stronger Playwright operational markers for the real marketing-drift guard.
- Removed the unnecessary `!important` from the deny button border.
- Reran `web:lint`, `web:typecheck`, `web:build`, `test:e2e`, `test:unit`, `verify:docs`, and `git diff --check` after fixes.
