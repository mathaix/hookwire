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

## Verification Constraints

### Automated Checks

- Run unit tests for allow, deny, ask, route, default decision, session scope, and unmatched actions.
- Run tests proving safe allow/deny decisions succeed with backend/network disabled.
- Run policy cache update tests with version changes and invalid bundle rejection.
- Run benchmark tests for safe allow, local deny, and cached policy evaluation latency.

### Proof Artifacts

- Attach unit test and benchmark output.
- Attach sample policy bundle and evaluator result snapshots.
- Attach network-mock assertion output, disabled-network test output, or trace output proving backend access is not attempted for safe local decisions.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on local hot-path performance, deterministic policy matching, and backend independence.
