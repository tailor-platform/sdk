---
"@tailor-platform/sdk": minor
---

`setup github` (beta): overhaul branch and tag deploy targets

**New capabilities**

- **Tag target** (`--tag`): deploy on tag push, with an optional tag-reachability guard (`--branch`) that skips tags not reachable from the target branch.
- **Plan enabled by default**: the plan job and pull-request trigger are now on by default. Pass `--no-plan` to opt out (branch targets only; cannot be combined with `--tag`).
- **Lock file** (`.github/tailor-sdk.lock`): tracks template version, content hash, and managed step ids. Re-running `setup github` regenerates cleanly; hand-edited files are detected and require `--force` to overwrite.
- **Target the workspace by id**: the generated `plan`/`deploy` jobs deploy to the workspace named by the `TAILOR_PLATFORM_WORKSPACE_ID` GitHub Environment variable. They never resolve a workspace by name or create one — provision the workspace and set the variable per environment before the first deploy. `deploy` errors when the variable is unset; `plan` reports "not provisioned yet".
- **`--environment`**: pin the plan and deploy jobs to a GitHub Environment for required-reviewer approval gates and per-environment secrets/variables. Defaults to the workspace name when omitted.
- **`--force`**: take over an unmanaged file or discard hand edits.
- **Auto-detection**: default branch is detected from `git` when `--branch` is omitted; package manager is detected from your lockfile.

**Breaking changes (beta)**

- `--with-plan` is removed; plan is now the default. Replace with `--no-plan` to disable.
- `--workspace-region` (`-r`), `--organization-id` (`-o`), and `--folder-id` (`-f`) are removed. The generated workflow no longer creates a workspace; instead it deploys to the workspace id in the `TAILOR_PLATFORM_WORKSPACE_ID` Environment variable. Provision the workspace and set that variable per GitHub Environment.
- Secret names in the generated workflow changed: `PLATFORM_MACHINE_USER_CLIENT_ID` → `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`, `PLATFORM_MACHINE_USER_CLIENT_SECRET` → `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET`. Update your GitHub repository secrets.
- In CI, `tailor-sdk apply` no longer auto-generates a missing app `id` in `tailor.config.ts` — it fails with instructions instead, because an id minted per CI run would make every deploy look like a brand-new app. CI dry-runs (plan) perform the same check read-only, so a forgotten `id` fails at PR time rather than at deploy. Run `tailor-sdk setup github` (or `apply` locally) once and commit the injected `id`. Pipelines that intentionally deploy a throwaway app per run can opt back in with `TAILOR_PLATFORM_SDK_ALLOW_CI_ID_INJECTION=true`.
