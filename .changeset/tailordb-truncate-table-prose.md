---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
---

`tailor tailordb truncate` now calls a `db.table()` definition a table instead of a type, in its help, prompts, and results. The positional argument is named `tables`, and `TruncateOptions.types` from `@tailor-platform/sdk/cli` is now `TruncateOptions.tables`:

```ts
await truncate({ types: ["User"] }); // before
await truncate({ tables: ["User"] }); // after
```

The command line is unchanged — table names are still passed positionally, as in `tailor tailordb truncate User Post`, so `tailor seed apply --truncate` and any scripted invocation keep working.
