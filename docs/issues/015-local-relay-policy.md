# Local relay policy cache and evaluator

Labels: `type:feature`, `area:local-relay`, `area:security`, `priority:p0`

Milestone: M2

## Objective

Implement the local relay policy cache and fast evaluator for safe local decisions.

## Scope

- Cached policy bundle format.
- Rule matcher for commands, operations, paths, and risk tags.
- Decisions: allow, deny, ask, route.
- Session-scoped approvals.
- Backend fallback only for routed approval requests.

## Acceptance Criteria

- Safe allow and deny decisions do not require backend access.
- Cached policy can be updated from the backend.
- Unknown actions follow the configured default decision.
- Evaluator returns matched rule, decision, risk, and route metadata.

