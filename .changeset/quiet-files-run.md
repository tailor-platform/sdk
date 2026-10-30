---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: Removed the `executable` option from the files a plugin returns in `GeneratorResult.files`. `tailor generate` no longer runs `chmod 755` on a generated file, so every generated file is written with the default permissions. A plugin that returns `executable: true` now gets a type error. To run a generated script, call it through its interpreter (`node generated/cli.mjs`, `sh generated/run.sh`), call it from a `package.json` script, or add a `chmod +x` step after `tailor generate`.
