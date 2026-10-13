---
"@tailor-platform/sdk": patch
---

Fix function execution logs coming back empty. The logs that `tailor-sdk function test-run`, `function logs`, `workflow executions --logs`, `executor jobs --logs`, TailorDB migrations, seeding, and `executeScript()` show are now read from the platform's structured log entries, joined with newlines, instead of the deprecated flat `logs` field the platform no longer fills.
