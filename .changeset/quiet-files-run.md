---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: Removed the `executable` option from the files a plugin returns in `GeneratorResult.files`. `tailor generate` no longer runs `chmod 755` on a generated file, so a file it creates gets the default permissions. `executable: true` is a type error only where the hook's return type is annotated (`: GeneratorResult`) or the file is pushed into a `GeneratorResult["files"]` array; a hook without an annotation, or one that builds its files through a variable or `.map`, compiles and the flag is silently ignored, so search your plugins for `executable` when you upgrade. A file that an earlier version made executable keeps that mode when it is regenerated, so run `chmod -x` on it once. To run a generated script, call it through its interpreter (`node generated/cli.mjs`, `sh generated/run.sh`), call it from a `package.json` script, or add a `chmod +x` step after `tailor generate`.
