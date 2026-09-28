---
"@tailor-platform/sdk": patch
---

Rewrite `workflow.start()` calls on a workflow that is default-exported from a workflow file as the result of a helper function (e.g. `export default module.workflows.syncGLBalances.create(mainJob)`, where the helper calls `createWorkflow()`). Previously only a `createWorkflow({ name: "..." })` call written directly in the file was recognized, so such calls failed the build (or, before that, threw at runtime after deploy). Wrapping the helper result in another `createWorkflow({ ...helperResult, name: "..." })` call is no longer needed.
