---
"@tailor-platform/sdk": patch
---

`tailor generate`, `tailor deploy`, and other commands that load TailorDB types, resolvers, executors, workflows, and HTTP adapters now print a loading failure once instead of two or three times. When several files fail to load at once, the files other than the reported one are listed by name without their errors.

An error that points at `tailor.config.ts` or at a TailorDB type, resolver, executor, workflow, or HTTP adapter file, such as a syntax or definition error, an invalid config, or any failure while loading one of those files, now starts with the file's path and, when known, the line, both in plain output and in the `--json` `message`: `tailordb/order.ts:3: Invalid syntax: Expression expected` instead of `Invalid syntax in tailordb/order.ts:3: Expression expected`. When `generate`, `deploy`, or `loadConfig` from `@tailor-platform/sdk/cli` throws one of these errors, its `error.message` no longer names the file; `errorToJson(error).error.message` does. An error marked with `withSourceLocation` is printed the same way unless it has its own `format()`.
