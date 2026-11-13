---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-frontend": minor
---

Pass an async function as `build` in `frontendPlugin` to run your own code before the upload, such as writing a runtime configuration file into `dist`. The function receives the deploy context, the `env` values, the absolute `workingDir` and `distDir`, the `profile` `tailor deploy` ran with, `exec` to run shell commands with those values, and `node` (Node.js's `fs/promises` as `fs`, and `pathe` as `path`) for file work, since `tailor.config.ts` cannot import `node:` modules. `onDeployed` hooks of any plugin receive the same `node` in their context. Importing `@tailor-platform/sdk/cli` in `tailor.config.ts` no longer breaks the bundles of functions that run on the Platform.
