---
"@tailor-platform/sdk": minor
---

Apply v2 CLI naming conventions:

- Rename the `crash-report` subcommand to `crashreport` to match the single-word convention used by other multi-word commands (`authconnection`, `staticwebsite`). The legacy `crash-report` name is preserved as a native alias and still works.
- Rename the positional arguments `executionId`, `executorName`, and `jobId` to their kebab-case form (`execution-id`, `executor-name`, `job-id`) on `function logs`, `workflow resume`, `workflow executions`, `executor jobs`, and `executor trigger`. Help output and generated docs now show the kebab-case form. Existing positional invocations are unaffected because positional arguments are referenced by position, not by name.
