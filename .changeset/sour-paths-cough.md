---
"@tailor-platform/sdk-codemod": patch
"@tailor-platform/sdk": patch
---

The v2 migration guide and `tailor upgrade` prompt for the programmatic CLI functions no longer say that `triggerExecutor`'s `payload` is typed from the executor definition. `payload` is accepted only for an executor with an incoming webhook trigger, and its shape is not checked; `startWorkflow`'s `arg` is still typed from the workflow definition.
