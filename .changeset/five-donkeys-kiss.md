---
"@tailor-platform/sdk": patch
---

A `tailor.config.ts` with no default export, a `plugins` export that is not an array, or two plugins sharing an `id` is now reported as an invalid config rather than an unexpected error. In `--json` output the error has `code: "CONFIG_INVALID"` instead of `UNEXPECTED_ERROR` and carries `context.file`, `context.exportName` and `context.issues`; the missing default export and the duplicate ID also carry a `suggestion`. Plain output prints `Error [CONFIG_INVALID]: tailor.config.ts: Invalid Tailor config:` or ``Invalid `plugins` export:`` followed by the issue list, and `error.message` of the error `loadConfig` from `@tailor-platform/sdk/cli` throws changes to that heading and list. Every rejected item of the `plugins` export is now listed in one error instead of only the first.
