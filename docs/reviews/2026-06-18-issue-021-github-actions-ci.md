# Issue 021 Proof: GitHub Actions CI for Public Repository

Issue: [GitHub Actions CI for public repository](../issues/021-github-actions-ci.md)

Date: 2026-06-18

Status: complete

## Commits

- `486e0e4` Add GitHub Actions CI workflow
- `1d129e2` Pin CI actions to v5 SHAs
- `14c8a96` Document CI required check context

## Local Verification

Failing-first evidence:

- Added unit tests for `checkGitHubActionsCi` and `checkOpenSourceGovernance` before implementation.
- Initial `npm run test:unit` failed with missing `checkGitHubActionsCi` and `checkOpenSourceGovernance` exports.

Passing local checks:

- `npm ci`: passed, 0 vulnerabilities.
- `npm run test:unit`: 22 tests passed; coverage 100% statements, 96.51% branches, 100% functions, 100% lines.
- `npm run verify:docs`: passed with `ok: true`, no missing CI or governance checks.
- `npx playwright install --with-deps chromium`: passed.
- `npm run test:e2e`: 2 Chromium tests passed.
- `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml")'`: passed.
- `git diff --check`: passed.

## GitHub Evidence

Repository remote:

- `origin https://github.com/mathaix/hookwire.git`

Passing CI:

- Run: https://github.com/mathaix/hookwire/actions/runs/27774306572
- Commit: `14c8a9688492dd3770be18afa10e0b770b928645`
- Event: `push`
- Workflow: `CI`
- Required check context: `Verification`
- Result: success

Completion proof CI:

- Run: https://github.com/mathaix/hookwire/actions/runs/27775254728
- Commit: `091d4c9e4385cd8b04d209c19f5da1b429599aea`
- Event: `push`
- Result: success

Failure-mode proof:

- Temporary PR: https://github.com/mathaix/hookwire/pull/1
- Run: https://github.com/mathaix/hookwire/actions/runs/27774525472
- Change: intentionally added a broken README link.
- Result: failure, with `Verification` failing before merge.
- Disposition: PR closed unmerged and branch deleted.

Playwright artifact proof:

- Temporary PR: https://github.com/mathaix/hookwire/pull/2
- Run: https://github.com/mathaix/hookwire/actions/runs/27774662441
- Change: intentionally added a failing Playwright test.
- Result: failure in `Run Playwright e2e`.
- Artifact: `playwright-report`, 641,525 bytes, not expired at verification time.
- Artifact API: `https://api.github.com/repos/mathaix/hookwire/actions/artifacts/7729829009/zip`
- Disposition: PR closed unmerged and branch deleted.

## Branch Protection Evidence

Final active protection is implemented with a repository ruleset. Classic branch protection was removed after GitHub treated a zero-review pull request rule as review-required.

Ruleset endpoint:

- `PUT /repos/mathaix/hookwire/rulesets/17851876`

Verified active rules for `main`:

```json
[
  {
    "type": "pull_request",
    "parameters": {
      "allowed_merge_methods": ["squash", "merge", "rebase"],
      "dismiss_stale_reviews_on_push": true,
      "require_code_owner_review": false,
      "require_last_push_approval": false,
      "required_approving_review_count": 0,
      "required_review_thread_resolution": true,
      "required_reviewers": []
    }
  },
  {
    "type": "required_status_checks",
    "parameters": {
      "required_status_checks": [{"context": "Verification", "integration_id": 15368}],
      "strict_required_status_checks_policy": true
    }
  },
  {"type": "deletion"},
  {"type": "non_fast_forward"},
  {"type": "update"}
]
```

Bypass policy:

- `bypass_actors`: `[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"pull_request"}]`
- `current_user_can_bypass`: `pull_requests_only`
- Effect: repository administrator bypass is limited to pull-request context. Direct pushes to `main` still fail under the `update` rule.

Direct push rejection proof:

```text
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: Review all repository rules at https://github.com/mathaix/hookwire/rules?ref=refs%2Fheads%2Fmain
remote: - Changes must be made through a pull request.
remote: - Required status check "Verification" is expected.
remote: - Cannot update this protected ref.
! [remote rejected] HEAD -> main (push declined due to repository rule violations)
```

## Claude Review

Review command:

```sh
git diff --cached | claude -p "Review this staged Hookwire issue 021 CI change. Focus only on blocking or high-risk problems..."
```

Final review result:

```text
Verdict: No blocking or high-risk findings

Prior finding status:
- Dead Playwright artifact upload: Fixed.
- Doubled CI status check name: Fixed.
- Mutable action tags: Fixed with SHA-pinned GitHub actions.
- Missing admin bypass docs: Fixed.
- Missing Playwright browser cache: Fixed.
- Node version duplication: Fixed.
```

Disposition:

- Fixed the initial high-risk artifact finding by enabling the Playwright HTML reporter, retries, traces, and artifact uploads for `playwright-report/` plus `test-results/`.
- Fixed the status check name by using workflow `CI` and job name `Verification`, then confirmed GitHub's required context is `Verification`.
- Fixed supply-chain review findings by pinning GitHub-owned actions to current `v5` SHAs.
- Fixed open-source governance gaps with `.nvmrc`, contributor docs, and documented administrator bypass policy.
