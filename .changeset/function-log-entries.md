---
"@tailor-platform/sdk": minor
---

Show structured log entries (message, severity, timestamp) in `tailor function logs <execution-id>` and in the per-job details of `tailor workflow start/wait/executions/resume --logs`. Entries are available while an execution is still running. Add `tailor function logs <execution-id> --follow` to stream new log entries until the execution completes, with an optional `--timeout`.
