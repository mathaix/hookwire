# GitHub Actions CI for public repository

Labels: `type:infra`, `area:ci`, `area:docs`, `priority:p0`

Milestone: M0

## Objective

Wire the public Hookwire repository to GitHub Actions so every pull request and main-branch update runs the verification gates expected for open-source contribution, and direct writes to `main` are blocked.

## Scope

- Configure the local repository remote to point at the public GitHub repository.
- Add GitHub Actions workflow files under `.github/workflows`.
- Configure GitHub repository rulesets or branch protection for `main`.
- Run unit tests with coverage thresholds.
- Run docs verification.
- Run Playwright e2e validation with browser installation/cache handling.
- Run Markdown/link checks through the existing verifier.
- Publish useful CI summaries for contributors.
- Document the CI workflow in the README or contributor docs.
- Add a minimal contribution guide if one does not exist.

## Acceptance Criteria

- `origin` is configured for the public Hookwire GitHub repository.
- GitHub Actions runs on pull requests and pushes to `main`.
- `main` requires pull requests before merging.
- `main` requires the GitHub Actions status checks to pass before merging.
- Direct pushes, force pushes, and branch deletion are blocked for `main`.
- Any administrator or maintainer bypass policy is explicit and documented.
- CI runs `npm ci`.
- CI runs `npm run test:unit` and fails below 90% coverage thresholds.
- CI runs `npm run verify:docs`.
- CI installs required Playwright browsers and runs `npm run test:e2e`.
- CI exposes artifacts or summaries for Playwright failures.
- README or contributor documentation explains how to run the same checks locally.
- The workflow is documented enough for outside contributors to understand required gates.

## Verification Constraints

### Automated Checks

- Run the full CI command set locally from a clean install path:
  - `npm ci`
  - `npm run test:unit`
  - `npm run verify:docs`
  - `npx playwright install --with-deps chromium` or the documented CI equivalent
  - `npm run test:e2e`
- Validate workflow YAML syntax.
- Push a branch or open a pull request and confirm the GitHub Actions workflow completes successfully.
- Confirm a failing coverage threshold or broken docs link causes CI failure.
- Confirm a direct push to `main` is rejected or attach repository ruleset evidence proving direct updates are blocked.
- Confirm pull requests cannot merge until the required CI checks pass.

### Proof Artifacts

- Attach local command output for the full CI command set.
- Attach GitHub Actions run URL for a passing run.
- Attach at least one failure-mode proof, such as a temporary branch/run or documented local reproduction showing CI fails on broken docs or insufficient coverage.
- Attach a screenshot or `gh api` output showing the `main` protection ruleset or branch protection settings.
- Attach proof that direct updates to `main` are blocked.
- Attach screenshots or logs for Playwright artifact behavior on failure.
- Attach the public repository remote URL.

### Claude Review Gate

- Required because this issue changes CI/runtime contribution infrastructure. Complete the standard [Claude review gate](../verification.md#claude-review-gate) with a focus on workflow correctness, supply-chain safety, secret exposure, reproducibility for external contributors, and whether CI enforces the documented gates.
