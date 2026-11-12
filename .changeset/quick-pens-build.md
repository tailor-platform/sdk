---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-frontend": minor
---

Pass an async function as `build` in `frontendPlugin` to run your own code before the upload, such as creating something on the Platform from the deployed site URL and writing its ID into `dist/config.json`. The function receives the deploy context, the `env` values, the absolute `workingDir` and `distDir`, `exec` to run shell commands with those values, and `api` to call a Platform endpoint. Add `ctx.api(endpoint, body)` to the context of plugin `onDeployed` hooks to call Platform endpoints as the user or machine user `tailor deploy` ran as.
