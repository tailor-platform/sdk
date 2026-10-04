---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-frontend": minor
---

Build and upload frontend assets during `tailor deploy` with `frontendPlugin` from `@tailor-platform/sdk-plugin-frontend`. Use deployed URLs and public OAuth client IDs as build environment variables, and read upload results from `outputs.frontends`.

The SDK provides the deployment hooks and shared context types. Successful `tailor deploy --json` results also include `workspaceId` and `applications` with deployed application, Static Website, and AI Gateway URLs, plus public OAuth client IDs, even without deploy plugins. The frontend plugin is a separate package; it has not shipped as an SDK built-in in a stable release.
