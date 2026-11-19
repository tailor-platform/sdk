---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: `tailor generate` resolves relative output paths in plugin options, such as a relative `distPath`, against the directory of `tailor.config.ts` instead of the current directory, and `tailor seed`, `tailor tailordb migration test`, and `tailor function script` read a relative seed or Kysely `distPath` the same way. This only changes where files go when the current directory is not the config's directory, for example when `--config` or `TAILOR_CONFIG_PATH` names a config in another directory: generated files now land next to that config. Move the files generated before into that directory and update the imports that point at them.
