---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-seed": minor
---

`tailor seed apply` now runs the TailorDB seed and the IdP `_User` seed, list and delete scripts as temporary workflows instead of synchronous script executions, so they are no longer cut off by the 60-second execution limit. For each namespace it registers a function, a job function and a workflow named `tailor-seed-<kind>--<namespace>` (`<kind>` is `tailordb`, `idp-seed`, `idp-list` or `idp-truncate`), runs every chunk through them, and removes them afterwards. A run interrupted before cleanup leaves them behind, and the next `tailor seed apply` for that namespace removes them first.

The seed and seed dump scripts are now minified. Set `buildOptions.inlineSourcemap` in `defineConfig` to embed a sourcemap and keep function names readable in stack traces.
