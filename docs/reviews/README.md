# Review Artifacts

Store local proof artifacts and Claude review summaries here when there is no PR system available yet.

Use filenames like:

```text
YYYY-MM-DD-issue-NNN-short-title.md
```

Each review artifact should include:

- Issue id and title.
- Commit hash or working-tree state.
- Verification commands and outputs.
- Claude review command.
- Claude findings.
- Disposition for each finding.

Do not store secrets, private keys, unredacted payloads, or provider credentials in review artifacts.

