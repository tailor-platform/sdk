---
"@tailor-platform/sdk": patch
---

`tailor deploy` now says when it reuses the earlier run of a multi-step migration instead of running its steps again: the migration's line reads "Steps of migration <namespace>/<number> completed in an earlier run and were not run again" and its logs appear under "Logs from the earlier run:". Previously the line read "completed successfully" as if the steps had just run.
