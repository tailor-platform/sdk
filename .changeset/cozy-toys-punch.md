---
"@tailor-platform/sdk": minor
---

Log views now tell lines the Platform added to an execution's logs apart from your function's own output. `function logs`, `workflow executions --logs` (and `workflow start/wait/resume --logs`), and `executor jobs/trigger --wait --logs` mark those lines with `[PLATFORM]`, and each log entry in `--json` output carries `source` (`USER`, `PLATFORM`, or `UNSPECIFIED`); executor job results also gain `functionLogEntries` and `workflowJobLogs[].logEntries`. `function logs` adds `hasPlatformLogs` to each execution, a best-effort flag where `false` does not guarantee there are none, and shows it as a column in the list table when any listed execution is flagged.
