---
"@tailor-platform/sdk": patch
---

Fix `workflow.start()` and job `.start()` calls that built and deployed but threw "workflow.start() is rewritten at build time and unavailable in the bundle" at runtime. These calls are now rewritten when:

- the workflow file is imported through a `tsconfig.json` `compilerOptions.paths` alias (e.g. `import workflow from "@/workflow/syncGLBalances"`)
- the workflow is default-exported as the result of a helper function that calls `createWorkflow()` (e.g. `export default module.workflows.syncGLBalances.create(mainJob)`); wrapping the helper result in another `createWorkflow({ ...helperResult, name: "..." })` call is no longer needed
- the workflow file is imported as a namespace (`import * as wf from "./workflows/sync"; wf.default.start(...)`)

A `.start()` call on an import from a workflow file that still cannot be rewritten — such as a helper-created workflow exported under a named export — now fails the build instead of deploying code that throws at runtime. The runtime error for an unrewritten `workflow.start()` also names the workflow.
