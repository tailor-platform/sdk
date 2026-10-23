---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk-plugin-seed": minor
"@tailor-platform/sdk-plugin-tailordb-erd": minor
---

The `tailor` CLI and its command groups, such as `tailor tailordb` and `tailor workspace`, and the setup, seed, and TailorDB ERD plugins now exit with code 2 when run without a subcommand and given an unknown option or an invalid option value, including one set through its environment variable. They previously printed their help or a warning, or ran their default subcommand, and exited with 0. `--no-json` and `--no-verbose` now turn JSON output and verbose logging off, where they were previously ignored with a warning, so `--no-json` also turns off the JSON output an AI coding agent gets by default. `--no-verbose` and `--verbose=false` also override `DEBUG=true` and `RUNNER_DEBUG=1`, which previously kept verbose logging on. Likewise, setting `logger.verbose` from `@tailor-platform/sdk/cli` overrides them, and setting it to `undefined` defers to them.
