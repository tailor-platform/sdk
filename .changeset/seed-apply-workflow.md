---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-seed": minor
---

`tailor seed apply` now runs the TailorDB seed and the IdP `_User` seed, list and delete scripts as temporary workflows instead of synchronous script executions, so they are no longer cut off by the 60-second execution limit. For each namespace it registers a function, a job function and a workflow named `tailor-seed-<kind>--<namespace>` (`<kind>` is `tailordb`, `idp-seed`, `idp-list` or `idp-truncate`), runs every chunk through them, and removes them afterwards. A namespace too long for the platform's 63-character name limit is cut short and followed by a hash. A run interrupted before cleanup leaves them behind, and the next `tailor seed apply` for that namespace removes them first.

If `tailor seed apply` finds the workflow of an earlier run still executing (for example, a chunk that keeps running on the platform after Ctrl-C), it stops with an error naming the execution instead of removing it. `tailor seed apply --truncate` runs this check for every seed workflow of the namespaces it touches before it deletes anything, so an interrupted run no longer leaves a truncated table that is not reseeded. Wait for that execution to finish and run the command again. Running `tailor seed apply` for the same namespace in two processes at once is not supported: if one of them fails while registering the function, it removes the resources of the other. If the command loses track of a running chunk (for example, a timeout while starting it), it removes the resources and cannot tell whether the chunk was applied, so check the table, then re-run with `--upsert`.

A TailorDB chunk that fails now stops the remaining chunks of that namespace, so later chunks do not fail on foreign keys of the rolled-back chunk or leave a gap in a table split across chunks.

The seed and seed dump scripts are now minified and, like other bundled functions, embed an inline sourcemap by default so error stack traces stay readable. Set `buildOptions.inlineSourcemap` to `false` in `defineConfig` to drop the sourcemap.
