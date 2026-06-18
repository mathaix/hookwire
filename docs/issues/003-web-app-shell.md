# Web app shell and navigation

Labels: `type:feature`, `area:web`, `priority:p0`

Milestone: M1

## Objective

Build the initial Hookwire web application shell for the approval control plane.

## Scope

- App layout with navigation for Inbox, Sessions, Policies, Routes, Integrations, Audit, and Settings.
- Organization and project switcher.
- Auth-ready user menu placeholder.
- Responsive desktop-first layout for operational use.

## Acceptance Criteria

- The first screen is the operational dashboard, not a marketing landing page.
- Navigation is stable and works across the main sections.
- Layout supports dense approval and session data.
- Mobile layout remains usable for approval review.

## Verification Constraints

### Automated Checks

- Run lint, typecheck, and production build for the web app.
- Run route/navigation tests for Inbox, Sessions, Policies, Routes, Integrations, Audit, and Settings.
- Run responsive smoke tests for desktop and mobile viewports.

### Proof Artifacts

- Attach build/test output.
- Attach desktop and mobile screenshots of the app shell.
- Attach route-test output or browser automation output proving the first route opens the operational dashboard and not a marketing page.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on operational UX, navigation completeness, responsive behavior, and avoiding marketing-page drift.
