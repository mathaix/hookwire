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

