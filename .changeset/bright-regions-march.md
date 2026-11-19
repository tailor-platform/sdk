---
"@tailor-platform/sdk": minor
---

**Breaking change**: `configArg` and `deploymentArgs` exported from `@tailor-platform/sdk/cli` no longer default `config` to `"tailor.config.ts"`, so a CLI plugin built on them gets `undefined` when neither `--config` nor `TAILOR_CONFIG_PATH` is given. Pass `args.config` as is to `loadConfig()`, which then uses the nearest `tailor.config.ts` in the current or a parent directory, or handle `undefined` where the plugin needs a path.
