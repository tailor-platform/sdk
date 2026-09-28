---
"@tailor-platform/sdk": patch
---

Fail the build when a `.start()` call on an import from a workflow file cannot be rewritten, instead of deploying code that throws at runtime. This covers a namespace import of a workflow file (`import * as wf from "./workflows/sync"`) and an export the build cannot recognize as a workflow or job, such as a workflow returned from a helper function. The runtime error for an unrewritten `workflow.start()` now also names the workflow.
