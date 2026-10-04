---
"@tailor-platform/sdk": minor
---

`tailor open` and `tailor auth-connection open` now always open the new Tailor Platform Console UI, which has replaced the previous UI at `console.tailor.tech`. `tailor open` opens `/workspaces/{workspaceId}/services/applications/{applicationName}` (previously `/workspaces/{workspaceId}/applications/{applicationName}/overview`), and `tailor auth-connection open` opens `/workspaces/{workspaceId}/services/auth-connections` (previously `/workspaces/{workspaceId}/settings/connections`). The `TAILOR_CONSOLE_NEXT` environment variable is no longer read: a leftover `TAILOR_CONSOLE_NEXT=1` no longer redirects the console host to `console-next.`, so it can be removed.
