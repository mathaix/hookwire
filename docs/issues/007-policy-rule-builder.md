# Policy and rule builder

Labels: `type:feature`, `area:web`, `area:backend`, `priority:p0`

Milestone: M1

## Objective

Create the first UI and backend model for configuring Hookwire rules.

## Scope

- Policy list and detail page.
- Rule creation and editing.
- Matchers for command prefix, command pattern, operation, path pattern, and risk tag.
- Decisions: allow, deny, ask, route.
- Local override settings.

## Acceptance Criteria

- Users can create and edit policy rules.
- Rules can point to routes.
- Rules can require override reasons.
- Rule order or priority is explicit.
- Policy data can be serialized for local relay cache later.

