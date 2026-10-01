---
"@tailor-platform/sdk-plugin-setup": minor
---

Add `tailor setup ci env`, which reads `.github/tailor.lock` and prints, per GitHub Environment, the secrets and variables the generated workflows read, as `gh` commands (default) or as Terraform for the `integrations/github` provider (`--format terraform`). Each entry says what the value is and where to get it, required and optional entries (Slack notifications, `TAILOR_PLATFORM_FAIL_ON_DRIFT`, the preview folder) are listed separately, and no values are included in the output. Pass `--environment <name>` (repeatable) to print only those environments. When the `origin` remote is on github.com, the output names that repository. The `gh` output creates an environment only when it does not exist yet; the Terraform output's header lists how to pass the values and import existing environments and variables, and leaves their protection settings untouched.

The Next steps printed by `setup ci branch`, `tag`, `preview`, and `coordinate` now point to this command for the environment just generated. As a result, `setup ci preview` no longer asks for `TAILOR_PLATFORM_WORKSPACE_ID`, which the preview workflow does not read, and instead lists `TAILOR_PLATFORM_ORGANIZATION_ID` (required, since a machine user cannot create a workspace without one) and `TAILOR_PLATFORM_FOLDER_ID`.

`tailor setup check` no longer requires `TAILOR_PLATFORM_WORKSPACE_ID` or checks the Slack variables in the local shell; it only audits the generated files, the lock, and the config, so it runs the same locally and in CI.
