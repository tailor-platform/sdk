---
"@tailor-platform/sdk": major
---

Rename CLI commands and positional arguments for consistency. Existing scripts that invoke `tailor-sdk crash-report` must be updated to use `tailor-sdk crashreport`.

- Rename the `crash-report` subcommand to `crashreport` to use single-word command names.
- Rename the positional arguments `executionId`, `executorName`, and `jobId` to kebab-case form (`execution-id`, `executor-name`, `job-id`) on `function logs`, `workflow resume`, `workflow executions`, `executor jobs`, and `executor trigger`. Help output and generated docs now show the kebab-case form. Existing positional invocations are unaffected because positional arguments are referenced by position, not by name.
