---
"@tailor-platform/sdk": minor
---

Add `TAILOR_CONSOLE_NEXT` environment variable to open the new Tailor Platform Console UI from `tailor open` and `tailor auth-connection open`. Setting `TAILOR_CONSOLE_NEXT=1` alone is enough: it redirects the console host from `console.` to `console-next.` and switches to the new UI's URL paths (`/workspaces/{workspaceId}/services/applications/{applicationName}` instead of `/workspaces/{workspaceId}/applications/{applicationName}/overview`, and `/workspaces/{workspaceId}/services/auth-connections` instead of `/workspaces/{workspaceId}/settings/connections`). An explicitly configured console URL (`TAILOR_PLATFORM_CONSOLE_URL` or a profile's `console_url`) is never rewritten.
