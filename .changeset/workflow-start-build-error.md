---
"@tailor-platform/sdk": patch
---

Fail the build when a `.start()` call on an import from a workflow file cannot be rewritten, instead of deploying code that throws at runtime — for example when the imported export is a workflow returned from a helper function, which the build cannot recognize. `.start()` calls through a namespace import of a workflow file (`import * as wf from "./workflows/sync"; wf.default.start(...)`) are now rewritten too. The runtime error for an unrewritten `workflow.start()` now also names the workflow.
