---
"@tailor-platform/sdk-plugin-setup": minor
---

Add `tailor setup ci env`, which reads `.github/tailor.lock` and prints, per GitHub Environment, the secrets and variables the generated workflows read, as `gh` commands (default) or as Terraform for the `integrations/github` provider (`--format terraform`). Required and optional entries (Slack notifications, `TAILOR_PLATFORM_FAIL_ON_DRIFT`) are listed separately, and no values are included in the output. The Next steps printed by `setup ci branch`, `tag`, `preview`, and `coordinate` now point to this command, so `setup ci preview` no longer asks for `TAILOR_PLATFORM_WORKSPACE_ID`, which the preview workflow does not read, and the preview entries now include the `TAILOR_PLATFORM_ORGANIZATION_ID` and `TAILOR_PLATFORM_FOLDER_ID` variables it does read.
