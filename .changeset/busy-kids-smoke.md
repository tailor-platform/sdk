---
"@tailor-platform/sdk": patch
---

`tailor generate` and `tailor function run` now read the config path from `TAILOR_CONFIG_PATH` when `--config` is not given, like other commands that take a single config file. If `TAILOR_CONFIG_PATH` holds comma-separated paths for `tailor deploy`, pass `--config` to these commands.
