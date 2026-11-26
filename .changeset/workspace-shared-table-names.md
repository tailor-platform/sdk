---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-seed": minor
---

A `defineWorkspace()` or `defineApp()` config (Beta) needs its TailorDB table names to be unique only across the namespaces each application lists, instead of across the whole workspace; a namespace no application lists is not compared with the others. `tailor generate`, `tailor deploy`, `tailor tailordb migration validate`, and the `tailor seed` commands apply this rule.

When several namespaces define a table name, the generated output tells the tables apart: `fileUtilsPlugin` keys such a table `"<namespace>.<Table>"`, `enumConstantsPlugin` starts its constants with the namespace (`CrmDbCustomerTier`), seedPlugin names its files `<namespace>.<Table>.jsonl` and `.schema.ts`, the `tailor seed` commands take that name as the table's entity name and in `--json` results, and `tailor tailordb migration test --data seed` reads those files. `seed apply` and `seed validate` stop when the base seed data still holds rows in a file named after such a table alone. A table whose name only one namespace defines keeps its own name, so the output of a config valid today does not change. Plugin-generated tables and the executors plugins generate are kept apart per namespace, two plugin executors with one name fail with `PLUGIN_EXECUTOR_NAME_DUPLICATE` instead of one replacing the other, and `getGeneratedTable()` takes the namespace to generate a table for.
