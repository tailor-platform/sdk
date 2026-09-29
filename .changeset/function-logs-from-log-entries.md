---
"@tailor-platform/sdk": patch
---

Function execution logs are now read from the platform's structured log entries instead of the deprecated flat `logs` field. The `logs` string that `function run`, `function logs --json`, `workflow executions --logs`, `executor jobs --logs`, TailorDB migrations, and `executeScript()` return joins the messages of those entries with newlines, and `function logs` no longer falls back to the flat string when an execution has no structured entries.
