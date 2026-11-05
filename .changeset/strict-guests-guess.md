---
"@tailor-platform/sdk-plugin-setup": patch
---

The plugin now loads `--env-file` and `--env-file-if-exists` before it reads its options, so `TAILOR_JSON_OUTPUT` from an env file turns on JSON output the same as shell variables, and a repeated `--env-file` loads every file.
