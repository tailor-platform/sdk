---
"@tailor-platform/sdk": minor
---

CLI commands now look for `tailor.config.ts` in parent directories when neither `--config` nor `TAILOR_CONFIG_PATH` is given, so running `tailor generate`, `tailor show`, or another command that reads the config from a subdirectory of your project uses the project's config instead of failing with `CONFIG_NOT_FOUND`. A `tailor.config.ts` in the current directory is still used first.
