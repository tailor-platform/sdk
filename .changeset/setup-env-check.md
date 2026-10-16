---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

Add `tailor setup ci env --check`, which reads GitHub with `gh` and reports which secrets and variables each GitHub Environment used by the generated workflows still lacks. It fails when a required entry is missing, only reports missing optional ones, and prints the `gh` commands that set the missing entries together with where each value comes from. Entries set on the repository or organization count as registered, and an entry registered as the wrong kind (a secret where the workflow reads a variable) is pointed out. When `gh` is not installed, not logged in, or cannot read the repository's secrets and variables, the check says so instead of reporting entries as missing.
