# Quality Gate

Installed under Architect instruction on October 5, 2026. Runs on pushes, pull requests and manual dispatch with read-only repository permissions. Check name: **Quality Gate**.

Scope: repository integrity plus applicable build or offline production tests.

Checks required source files, tracked JSON (including duplicate keys), Python and JavaScript syntax, merge conflict markers, runtime environment files and selected credential/private-key patterns. Secret detection is a limited pattern check, not a complete secret scanner. 

Evidence artifact records the checked-out SHA and baseline results. Application/test step results remain in the workflow log; a passing baseline artifact alone is not a passing workflow. On PRs the tested SHA can be GitHub's synthetic merge commit; after merge, require a successful push run on the actual release SHA.

A green gate certifies only these offline checks. It does not certify live avatar save/reload, provider execution, footage continuity, rights approval, deployment or autonomous publication. CI supplies no production provider credentials and performs no generation calls.

## Merge enforcement

Require **Quality Gate** for the default branch using repository Settings → Rules → Rulesets or branch protection, with up-to-date checks and no ordinary bypass. The connected GitHub integration denies branch-protection administration; workflow installation alone does not enforce merging. Enforcement is pending until confirmed in GitHub settings. Keep existing stronger release/approval requirements.

Future executable Avatar State, provenance and continuity-capsule contracts must gain behavioral tests as they are implemented. Markdown contract presence does not prove runtime enforcement. Never change acceptance rules solely to turn a failing check green.
