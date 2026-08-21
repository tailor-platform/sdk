---
"@tailor-platform/sdk": patch
---

Deprecate `execJobFunction` on the `workflow` value imported from `@tailor-platform/sdk/runtime`(`/workflow`); it is removed in v3. Calling a workflow job by name through it has no working use — the build already rejects a direct call to it from inside a job body — so call the target job's own `.start()` method instead. The ambient `tailor.workflow.execJobFunction` global (what `.start()` itself compiles down to) is unaffected.
