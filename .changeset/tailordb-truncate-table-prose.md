---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
---

`tailor tailordb truncate` now calls a `db.table()` definition a table instead of a type, in its help, prompts, and results. The positional argument is named `tables`, and `TruncateOptions.types` from `@tailor-platform/sdk/cli` is now `TruncateOptions.tables`:

```ts
await truncate({ types: ["User"] }); // before
await truncate({ tables: ["User"] }); // after
```

Passing table names positionally is unchanged, as in `tailor tailordb truncate User Post`. The argument also binds by name, so an invocation spelled `--types User` now has to read `--tables User`.
