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

