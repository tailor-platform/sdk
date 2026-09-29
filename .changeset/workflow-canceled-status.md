---
"@tailor-platform/sdk": patch
---

Workflow commands now recognize canceled workflow executions. `workflow start --wait`, `workflow executions <id> --wait`, and similar waits stop at a canceled execution as a failure instead of polling until they time out, a TailorDB migration whose workflow is canceled fails instead of waiting indefinitely, the status is shown as `CANCELED` rather than `UNSPECIFIED`, and `workflow executions --status CANCELED` is accepted.
