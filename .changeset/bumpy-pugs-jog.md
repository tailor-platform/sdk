---
"@tailor-platform/sdk": minor
---

CLI commands now look for `tailor.config.ts` in parent directories when neither `--config` nor `TAILOR_CONFIG_PATH` is given, so running `tailor generate`, `tailor show`, or another command that reads the config from a subdirectory of your project uses the project's config instead of failing with `CONFIG_NOT_FOUND`. A `tailor.config.ts` in the current directory is still used first. `tailor deploy` now remembers which Secret Manager secrets and Auth Connection client secrets it has applied per config instead of per current directory, so it skips the unchanged ones from any directory. If you have deployed with `--config` or `TAILOR_CONFIG_PATH` naming a config in another directory, the next deploy updates those secrets once.
