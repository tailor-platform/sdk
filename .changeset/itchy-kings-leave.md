---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: `tailor generate` resolves relative paths of the files plugins generate, such as a built-in plugin's relative `distPath`, against the directory of `tailor.config.ts` instead of the current directory, and `tailor seed`, `tailor tailordb migration test`, and `tailor function script` read a relative seed or Kysely `distPath` the same way. This only changes where files go when the current directory is not the config's directory, for example when `--config` or `TAILOR_CONFIG_PATH` names a config in another directory: generated files now land next to that config. Move the files generated before into that directory and update the imports that point at them. A custom plugin's generation-time hook still runs in the current directory, so a hook that builds paths of its own from a relative path in its options, such as an import between generated files, needs to resolve that path against `path.dirname(ctx.configPath)` first.
