---
"@tailor-platform/sdk": minor
---

Add `tailor.workflow.execJobFunction` as the canonical name for executing a workflow job function and returning its result. `startJobFunction` and `triggerJobFunction` remain available as aliases with the same behavior; `@deprecated` markers now point users at `execJobFunction`. Bundled workflow output emitted by the SDK now targets the canonical `execJobFunction` name.
