---
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Switched this plugin's internal CLI argument parsing and schema validation from Zod/`politty` to Valibot/`@politty/valibot`. The plugin's own CLI flags and configuration options are unchanged; only the wording of validation error messages may differ.
