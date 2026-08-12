---
"@tailor-platform/sdk": minor
---

Allow generated GitHub workflows to fail on unsuppressed setup drift when the `TAILOR_PLATFORM_FAIL_ON_DRIFT` repository variable is set to `true`. Execution and configuration errors in the drift check now fail regardless of this variable. Re-run the relevant `tailor setup` command after upgrading to regenerate the workflow.
