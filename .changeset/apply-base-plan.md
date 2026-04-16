---
"@tailor-platform/sdk": minor
---

Add `--base` option to `tailor-sdk apply` for previewing the merged state

Run `tailor-sdk apply --base` to preview the plan as it would look if the
current branch were merged into its base branch. The command creates a
temporary git worktree, merges HEAD into the base ref (no commit), and runs
the plan against that merged state. This is useful in CI for previewing the
deployment impact of a pull request before merging.

The base ref is auto-detected from the current GitHub PR (via `gh`) or
`origin/HEAD`. Override with `--base-ref <ref>`. `--base` implies `--dry-run`
and disables caching.
