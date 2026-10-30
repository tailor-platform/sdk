---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: Removed the `executable` option from the files a plugin returns in `GeneratorResult.files`. `tailor generate` no longer runs `chmod 755` on a generated file, so a file it creates gets the default permissions. Writing `executable: true` directly in an object literal is now a type error, but a plugin that builds its files through a variable or `.map` gets no error and the flag is silently ignored, so search your plugins for `executable` when you upgrade. A file that an earlier version made executable keeps that mode when it is regenerated, so run `chmod -x` on it once. To run a generated script, call it through its interpreter (`node generated/cli.mjs`, `sh generated/run.sh`), call it from a `package.json` script, or add a `chmod +x` step after `tailor generate`.
