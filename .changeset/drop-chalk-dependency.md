---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-codemod": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Drop the `chalk` dependency in favor of Node's built-in `util.styleText`. Colored CLI output is unchanged, and `NO_COLOR` / `FORCE_COLOR` / non-TTY detection keep working as before.
