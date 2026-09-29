---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": minor
---

`defineConfig()` accepts `buildOptions`, which groups the settings that control how resolvers, executors, workflow jobs, and other functions are bundled: `inlineSourcemap`, `logLevel`, and `allowedRuntimeGlobals`. The top-level `inlineSourcemap` and `logLevel` still work but are deprecated and will be removed in v3; `tailor upgrade` moves them into `buildOptions` with the `v3/define-config-build-options` codemod. Setting the same option both at the top level and in `buildOptions` fails config validation instead of silently using one of them.

```ts
export default defineConfig({
  name: "my-app",
  buildOptions: {
    inlineSourcemap: false,
    logLevel: "WARN",
  },
});
```
