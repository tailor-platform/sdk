---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": minor
---

`files` in `db`, `resolver`, `executor`, `workflow`, and `httpAdapter` now treats a pattern starting with `!` as an exclusion: for each file, the last `files` pattern that matches it decides. Before, such a pattern matched nothing and excluded nothing, so a config that already lists `!` patterns now leaves those files out, and the next deploy removes the resources they defined. A file that several `files` patterns match is now loaded once.

`ignores` is deprecated and will be removed in v3, together with the default exclusion of `**/*.test.ts` and `**/*.spec.ts`. `tailor upgrade` runs the `v3/files-ignores-to-negation` codemod, which moves `ignores` into `files` as `!` patterns and adds `"!**/*.test.ts"` and `"!**/*.spec.ts"` to services without `ignores`.

```ts
export default defineConfig({
  name: "my-app",
  executor: {
    files: ["executors/**/*.ts", "!executors/ci-only.ts"],
  },
});
```
