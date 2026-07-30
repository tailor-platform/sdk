---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-codemod": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Drop the `chalk` dependency in favor of Node's built-in `util.styleText`, and decide color support per output stream. Diagnostics on stderr now keep their colors when you redirect stdout (`tailor executor list > out.txt`), and stop writing escape codes into the file when you redirect stderr (`tailor deploy 2> log.txt`). `NO_COLOR`, `FORCE_COLOR` and non-TTY detection keep working as before.
