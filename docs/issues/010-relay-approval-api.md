# Relay-facing approval request API

Labels: `type:feature`, `area:backend`, `area:local-relay`, `priority:p0`

Milestone: M2

## Objective

Create the backend API contract that local relays use to create approval requests and poll or subscribe for decisions.

## Scope

- Endpoint to create approval requests.
- Redacted payload envelope validation.
- Project and installation authentication.
- Decision retrieval endpoint.
- Request timeout handling.

## Acceptance Criteria

- A local relay can create a pending approval request.
- Request payloads are tied to organization, project, installation, and session.
- The API rejects unregistered installations.
- A relay can obtain the final approve or deny decision.

## Verification Constraints

### Automated Checks

- Run API tests for signed approval request creation, unsigned request rejection, invalid signature rejection, revoked credential rejection, stale timestamp rejection, replayed nonce rejection, and wrong project/org binding rejection.
- Run tests proving created requests include organization, project, agent tool, installation, session, hook event, route, and redacted payload references.
- Run tests for decision retrieval before decision, after approval, after denial, and after timeout.

### Proof Artifacts

- Attach API test output with request ids and expected status codes.
- Attach sample signed request context with key id, timestamp, nonce, body hash, and signature redacted as needed.
- Attach database query output showing created request identity bindings and final decision retrieval.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on signed request verification, replay protection, tenant binding, and relay-facing API ergonomics.
