---
"@tailor-platform/sdk": minor
---

`setup github` (beta): overhaul branch and tag deploy targets

**New capabilities**

- **Tag target** (`--tag`): deploy on tag push, with an optional tag-reachability guard (`--branch`) that skips tags not reachable from the target branch.
- **Plan enabled by default**: the plan job and pull-request trigger are now on by default. Pass `--no-plan` to opt out (branch targets only; cannot be combined with `--tag`).
- **Lock file** (`.github/tailor-sdk.lock`): tracks template version, content hash, and managed step ids. Re-running `setup github` regenerates cleanly; hand-edited files are detected and require `--force` to overwrite.
- **`--environment`**: pin the deploy job to a GitHub Environment for required-reviewer approval gates.
- **`--force`**: take over an unmanaged file or discard hand edits.
- **Auto-detection**: default branch is detected from `git` when `--branch` is omitted; package manager is detected from your lockfile.
- **`--organization-id` and `--folder-id` are optional**: both are used only to create the workspace on the first deploy (matching `workspace create`), so deploys to an existing workspace no longer need them.

**Breaking changes (beta)**

- `--with-plan` is removed; plan is now the default. Replace with `--no-plan` to disable.
- Secret names in the generated workflow changed: `PLATFORM_MACHINE_USER_CLIENT_ID` → `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`, `PLATFORM_MACHINE_USER_CLIENT_SECRET` → `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET`. Update your GitHub repository secrets.
- In CI, `tailor-sdk apply` no longer auto-generates a missing app `id` in `tailor.config.ts` — it fails with instructions instead, because an id minted per CI run would make every deploy look like a brand-new app. CI dry-runs (plan) perform the same check read-only, so a forgotten `id` fails at PR time rather than at deploy. Run `tailor-sdk setup github` (or `apply` locally) once and commit the injected `id`. Pipelines that intentionally deploy a throwaway app per run can opt back in with `TAILOR_PLATFORM_SDK_ALLOW_CI_ID_INJECTION=true`.
