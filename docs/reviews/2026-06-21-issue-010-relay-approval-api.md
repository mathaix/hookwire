# Issue 010: Relay-Facing Approval Request API Review

Issue: [Relay-facing approval request API](../issues/010-relay-approval-api.md)

Branch: `codex/issue-010-relay-approval-api`

Implementation commit: `ea11564 Implement relay approval API`

## Verification Evidence

- `npx vitest run tests/unit/relay-approval-api.test.ts --coverage.enabled=false`: 9 tests passed.
- `npm run test:unit`: 85 tests passed, branch coverage 90.18%.
- `npm run proof:issue010:relay`: passed and wrote [2026-06-20-issue-010-relay-api-proof.json](2026-06-20-issue-010-relay-api-proof.json).
- `npm run web:typecheck`: passed.
- `npm run web:lint`: passed.
- `npm run verify:docs`: passed.
- `npm run web:build`: passed.
- `npm run test:e2e`: 25 tests passed.

## Claude Review

Command used:

```sh
claude -p --settings /Users/mantiz/.claude/settings.local.json --effort low --tools "" -- "<embedded issue 010 relay service and route review prompt>"
```

The global Claude settings currently print this warning before output:

```text
Permission deny rule "Dont read .env file" matches no known tool — check for typos.
```

Review result:

```text
No blocking or high-risk findings.

The security-critical chains hold up:

- Signature chain is sound. The canonical message binds method, path, keyId, timestamp, nonce, and bodyHash.
- Replay protection is correct. Nonce uniqueness is enforced at the DB level with a 23505 to 409 mapping.
- Tenant binding is enforced at every read/write. Credential is the source of truth for org/project/installation/tool.
- Redacted-payload validation requires redacted === true and recursively rejects non-[REDACTED] string values under sensitive-looking keys.
- Timeout handling is lazy-but-correct.
- Decision retrieval returns coherent shapes for pending/approved/denied/expired.
```

Residual risks from Claude:

- Relay-supplied `approval.expiresAt` can be later than the route timeout. Current behavior treats route timeout as the default when no expiry is supplied, not as a hard ceiling. Disposition: accepted for this issue because the relay API contract permits explicit request expiry, and tests/proof cover timeout behavior. If product semantics require route timeout to be a maximum, add a follow-up change to clamp or reject longer expirations.
- The implementation is Ed25519-only. Disposition: accepted; Ed25519 is the documented v1 contract.
- Relay timestamps must be ISO-8601 strings. Disposition: accepted; the v1 signing contract documents timestamp as part of the canonical string and relay clients should emit ISO-8601.
- Sensitive-key redaction validation is heuristic. Disposition: accepted as defense-in-depth; local redaction remains the primary boundary.
- Failed requests roll back nonce insertion, so a nonce from a failed request can be reused and fail again. Disposition: accepted; successful replay protection is enforced by the unique nonce row.
- The service uses one `pg.Client` per request. Disposition: accepted for MVP; pooling can be added when production deployment requirements are finalized.
