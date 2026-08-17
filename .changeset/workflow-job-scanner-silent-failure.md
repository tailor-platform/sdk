---
"@tailor-platform/sdk": patch
---

Fail the build instead of silently dropping a workflow job. A `createWorkflowJob` whose `name`/`body` isn't a static literal (e.g. `body: someWrapper(fn)`), or a job's `.start()` call factored into a helper function outside any job body, previously passed typecheck/lint/apply but threw at runtime ("...is rewritten at build time and is unavailable in the bundle") the first time the job was invoked. Both cases now fail the build with the offending job name and file, and the runtime stub error also names the job so a leftover case is easier to diagnose.
