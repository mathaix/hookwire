# Contributing to Hookwire

Hookwire is an open-source approval router for AI coding agents. Contributions should keep the repository easy to verify from a fresh checkout and should update public-facing docs when behavior, setup, or architecture changes.

## Local Verification

Use Node.js 22, matching CI. If you use `nvm`, run `nvm use` from the repository root.

Run the same checks that CI runs before opening a pull request:

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:unit
npm run verify:docs
npm run test:e2e
```

Unit tests must keep at least 90% coverage. Issue work should add failing tests first, then implementation, then proof that the relevant checks pass.

## Pull Request Flow

All changes should land through a pull request. Repository policy: direct pushes to `main` are blocked by the repository ruleset or branch protection, and pull requests must pass the required status checks before merge.

The expected required status check context is:

- `Verification`

GitHub may display that job under the `CI` workflow in the Actions UI.

Direct-push bypass is disabled. Repository administrators may only use the configured pull-request bypass to complete PR-based merges; any emergency broadening of bypass permissions must be temporary and documented in the related issue or pull request before considering the work complete.

Do not merge a functional, runtime, security-sensitive, or code-bearing issue until its Claude review findings are resolved or dispositioned according to [docs/verification.md](docs/verification.md).

## Documentation

Hookwire is intended to be developed in public. Keep the README, architecture docs, data model docs, issue specs, and verification evidence current when changing behavior or contributor workflows.
