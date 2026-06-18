# Verification and Review Standard

Every Hookwire issue must be closed with evidence. A passing implementation is not enough unless the proof shows that the issue's acceptance criteria and verification constraints were exercised.

## Required Proof Package

Each issue implementation should produce a proof package with:

- Issue id and title.
- Commit or PR reference.
- Commands run, with exit status and relevant output.
- Test names or suites that map to the issue's acceptance criteria.
- Screenshots or recordings for user-facing flows.
- Database query output for persistence, audit, tenancy, or identity claims.
- API request/response examples for backend contracts.
- Security evidence for authentication, authorization, redaction, revocation, replay protection, and tenant isolation.
- Claude review output and disposition of findings.

Do not mark an issue complete when proof is indirect, partial, or only covers a narrower path than the issue describes.

## Verification Constraint Pattern

Each issue defines three verification sections:

- **Automated Checks**: commands, tests, migrations, static checks, benchmarks, or browser checks that must pass.
- **Proof Artifacts**: concrete evidence to attach to the PR or store under `docs/reviews/` when working locally.
- **Claude Review Gate**: independent Claude review focused on the issue's risk area.

## Claude Review Gate

Every issue requires a Claude review before it is considered done. For documentation-only or planning-only issues, Claude reviews the docs, acceptance criteria, verification constraints, and proof package. For code-bearing issues, Claude also reviews the implementation code, tests, security properties, and runtime behavior.

Code-bearing means an issue changes executable source, schema migrations, configuration that affects runtime behavior, installer logic, integration behavior, or tests. Pure planning, prose-only docs, and issue-maintenance changes are not code-bearing, but they still require a Claude review focused on documentation correctness and completeness.

Use the reproducible per-issue path by default:

- `git diff <base> | claude -p "<review prompt>"` for diff-focused review.
- `claude -p "<review prompt>" --add-dir "$(git rev-parse --show-toplevel)"` for issue-focused review that needs Claude to inspect files directly.

Optional branch-wide review:

- `claude ultrareview [target]` can be used for branch-wide or PR-wide review when the installed Claude CLI supports it. Confirm availability with `claude ultrareview --help`. This path may be cloud-hosted, billed, and broader than a single issue, so it should supplement rather than replace the issue-focused review unless the proof package explains why it covers the issue completely.

The review prompt must include:

- The issue file path.
- The acceptance criteria.
- The implementation files changed.
- The proof artifacts collected.
- A request to focus on correctness, security, privacy, test coverage, edge cases, and missed requirements.

Required disposition:

- P0/P1 findings must be fixed before completion.
- P2 findings must be fixed or explicitly deferred with rationale.
- False positives must be documented with evidence.
- The final issue proof must include the Claude review command, raw review output, optional summary, and disposition.

Recommended issue-focused prompt:

```text
Review this Hookwire issue implementation as a senior code reviewer.

Issue: docs/issues/NNN-title.md
Changed files: <list files>
Verification evidence: <commands, screenshots, query output, proof artifacts>

Check whether the implementation satisfies every acceptance criterion and verification constraint.
Focus on security, tenant isolation, privacy/redaction, auditability, edge cases, and missing tests.
Return findings ordered by severity with file/line references where possible.
If there are no blocking findings, say so and list residual risks.
```

## Evidence Strength

Strong evidence:

- A targeted test that fails before the change and passes after.
- Database constraints or query output proving tenant and identity behavior.
- Browser screenshots for specific UI states named in the issue.
- API traces showing both success and failure paths.
- Claude review output with findings disposition.

Weak evidence:

- A build passing without targeted assertions.
- A screenshot of only the happy path when the issue requires error or unauthorized states.
- A seed script that creates data but no test that verifies behavior.
- A broad code review that does not reference the issue's acceptance criteria.

## Completion Checklist

Before closing an issue:

- [ ] Every acceptance criterion has direct evidence.
- [ ] Every automated check listed in the issue has run or has a documented blocker.
- [ ] Every proof artifact listed in the issue is attached or linked.
- [ ] Claude review has run and findings are resolved or dispositioned.
- [ ] Security/privacy claims are backed by negative tests, not just happy paths.
- [ ] Audit behavior is verified when the issue touches identity, decisions, policies, routes, integrations, or credentials.
