---
"@tailor-platform/sdk": patch
---

Workflow commands now recognize canceled workflow executions. `workflow start --wait`, `workflow wait`, `workflow executions <id> --wait`, and `executor jobs --wait` over a workflow stop at a canceled execution and fail with `WORKFLOW_EXECUTION_CANCELED` instead of polling until they time out, a TailorDB migration whose workflow is canceled fails instead of waiting indefinitely, the status is shown as `CANCELED` rather than `UNSPECIFIED`, and `workflow executions --status CANCELED` is accepted.
