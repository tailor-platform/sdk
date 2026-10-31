---
"@tailor-platform/sdk": minor
---

With `--json`, `tailor workspace create --ttl` now reports how recording the expiry went: `ttl.state` is `written` with `expiresAt`, or `unconfirmed` with `requestedExpiresAt` when the command fails with `WORKSPACE_TTL_WRITE_FAILED` after creating the workspace. A script can read the workspace ID from that output and record the expiry again with `tailor workspace ttl set`. Both the command and `createWorkspace({ ttl })` now try the expiry write a second time before reporting it unconfirmed. The expiry that `tailor workspace create`, `createWorkspace({ ttl })`, and `tailor workspace ttl set` report is now the instant the workspace records, at one-second resolution, matching `tailor workspace get`.
