# Project foundation and architecture docs

Labels: `type:design`, `area:backend`, `area:web`, `priority:p0`

Milestone: M0

## Objective

Create the initial repository foundation for Hookwire and document the product architecture, implementation sequence, and stack decisions.

## Scope

- README with product summary and first milestone.
- Architecture document covering web app, backend, local relay, installer, integrations, and optional NATS.
- Backlog documents for implementation issues.
- Naming updated to Hookwire everywhere.

## Acceptance Criteria

- A new contributor can understand what Hookwire is from the README.
- Architecture docs distinguish local runtime from hosted control plane.
- The docs state that Postgres is the source of truth and NATS is optional after v1.
- The issue backlog exists under `docs/issues`.

## Verification Constraints

### Automated Checks

- Run `rg -n "Hookrail" README.md docs --glob '!docs/issues/001-project-foundation.md' --glob '!docs/reviews/**'` and prove there are no unintended legacy product-name references in current product docs.
- Run a link/path check for README and docs links.
- Verify every issue listed in `docs/issues/README.md` exists as a Markdown file.

### Proof Artifacts

- Attach command output for the stale-name scan, link/path check, and issue-file existence check.
- Include a short contributor-readiness review showing the README points to architecture, data model, issue backlog, and implementation plan.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on product coherence, naming consistency, and whether the docs give a new contributor enough context to start.
