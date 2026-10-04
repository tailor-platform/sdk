---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-frontend": minor
---

Add `frontendPlugin` from `@tailor-platform/sdk-plugin-frontend` to build and upload frontend assets during `tailor deploy`. Frontend builds can use deployed URLs and public OAuth client IDs as environment variables, and deployment results include uploaded frontend details in `outputs.frontends`.

Add deployment hooks and shared context types to `@tailor-platform/sdk`. Successful `tailor deploy --json` results now include `workspaceId` and `applications` with deployed application, Static Website, and AI Gateway URLs, plus public OAuth client IDs, even when no deploy plugins are configured.
