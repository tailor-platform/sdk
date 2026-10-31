---
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

The plugin now loads `--env-file` and `--env-file-if-exists` before it reads its options, so values from an env file, such as `TAILOR_CONFIG_PATH` or `TAILOR_JSON_OUTPUT`, take effect the same as shell variables, and a repeated `--env-file` loads every file.
