---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

Add `--codemod` to `tailor setup ci autofix`, so the autofix workflow handles the codemods of a pull request that upgrades `@tailor-platform/sdk`, such as one from Renovate. It upgrades each app from the version the base branch's lockfile resolves to the version the pull request installs. `warn` reports what `tailor upgrade` would rewrite and the changes it leaves for review, `error` reports them as errors and fails the `tailor-codemod-result` job, which also fails when the autofix job fails or is cancelled, and `deterministic` commits the rewrites with what `tailor generate` changes and reports the rest. `tailor setup update` keeps the `--codemod` value, and without `--codemod` the workflow is the same as before. With `error`, a review that still matches after you finish the migration keeps the check failing until the base branch has the new version. `deterministic` leaves files under `.github/workflows` out of the fix commit and reports them for you to commit, and a bun repository needs `bun.lock` instead of `bun.lockb`.
