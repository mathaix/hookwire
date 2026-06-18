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

## Verification Constraints

### Automated Checks

- Run CRUD tests for policies and rules.
- Run matcher tests for command prefix, command pattern, operation, path pattern, and risk tag.
- Run priority/order tests proving deterministic rule evaluation order.
- Run serialization snapshot tests for the local relay policy bundle.
- Run authorization tests proving only eligible project/org users can edit policies.

### Proof Artifacts

- Attach test output and sample serialized policy bundle.
- Attach screenshots of rule creation, route selection, override settings, and rule ordering.
- Attach database query output showing policy version and rule priority values.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on deterministic evaluation, cache serialization, rule safety, and policy-edit authorization.
