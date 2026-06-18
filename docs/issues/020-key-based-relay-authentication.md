# Key-based relay authentication and revocation

Labels: `type:feature`, `area:security`, `area:backend`, `area:local-relay`, `area:onboarding`, `priority:p0`

Milestone: M1

## Objective

Prevent spoofed relay, session, and approval-request identity by using automatically generated public/private keys for local Hookwire installations.

## Scope

- CLI-side keypair generation during onboarding.
- Secure local private key storage.
- Public key registration in the backend.
- Signed relay API requests.
- Nonce and timestamp replay protection.
- Credential revocation and rotation.
- Audit events for registration, use, revocation, and rotation.

## Acceptance Criteria

- `hookwire login` or onboarding generates an asymmetric keypair locally.
- The private key is stored locally and never sent to the backend.
- The backend stores public key, key fingerprint, algorithm, status, registering user, project, tool, and installation.
- Relay requests include key id, timestamp, nonce, body hash, and signature.
- Backend request verification checks signature, key status, installation status, timestamp freshness, nonce uniqueness, and project/org binding.
- Revoking a key immediately blocks relay API access for that installation credential.
- Key rotation can replace a credential without losing the installation record.
- Revocation and rotation are visible in audit history.
- Tests cover invalid signatures, replayed nonces, stale timestamps, revoked credentials, and mismatched project ids.

## Notes

Use Ed25519 by default unless a target platform lacks solid support. The backend should treat local OS usernames, agent-supplied session ids, and machine names as metadata only; none of those fields should be trusted for authorization without a verified installation signature.

## Verification Constraints

### Automated Checks

- Run crypto tests for key generation, request signing, signature verification, body hash mismatch, wrong key id, wrong project id, wrong organization id, and malformed signatures.
- Run replay-protection tests for stale timestamps and reused nonces.
- Run revocation tests proving revoked credentials cannot create sessions, create approval requests, sync audit events, or receive decisions.
- Run rotation tests proving a replacement credential can be activated before the old credential is revoked.
- Run static/logging checks proving private key material is not sent to backend APIs or written to logs.

### Proof Artifacts

- Attach crypto and API test output.
- Attach sanitized signed-request examples showing key id, timestamp, nonce, body hash, and signature.
- Attach database query output for active, rotated, and revoked credentials.
- Attach audit rows for registration, rotation, and revocation.

### Claude Review Gate

- Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on cryptographic binding, replay resistance, revocation completeness, key storage, and private-key leak risks.
