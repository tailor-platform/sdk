---
"@tailor-platform/sdk": minor
---

With `--json`, `tailor workspace create --ttl` now reports how recording the expiry went: `ttl.state` is `written` with `expiresAt`, or `unconfirmed` with `requestedExpiresAt` when the command fails with `WORKSPACE_TTL_WRITE_FAILED` after creating the workspace. A script can read the workspace ID from that output and record the expiry again with `tailor workspace ttl set`. Both the command and `createWorkspace({ ttl })` now try the expiry write a second time before reporting it unconfirmed. The expiry that `tailor workspace create`, `createWorkspace({ ttl })`, and `tailor workspace ttl set` report is now the instant the workspace records, at one-second resolution, matching `tailor workspace get`.

`tailor workspace create --ttl`, `createWorkspace({ ttl })`, `tailor workspace ttl set`, and `tailor tailordb migration test --keep-ttl` now reject a TTL of 50,000,000 days or more before contacting the Platform. Previously a TTL past the supported date range made `tailor workspace create` fail with an unexpected error after creating the workspace.
