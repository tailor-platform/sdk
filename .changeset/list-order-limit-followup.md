---
"@tailor-platform/sdk": minor
---

Wire `--order` / `--limit` through the remaining list commands that were missed in the previous pass: `workspace list`, `workspace user list`, `workspace app list`, `organization folder list`, `executor webhook list`, and `crash-report list`. Existing behavior is preserved when the flags are omitted (server-default order, unlimited), so scripts already invoking these commands are unaffected. The programmatic helpers (`listWorkspaces`, `listUsers`, `listApps`, `listFolders`, `listWebhookExecutors`) accept a new optional `order` field with the same defaults.
