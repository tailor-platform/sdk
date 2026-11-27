---
"@tailor-platform/sdk": patch
---

`tailor deploy`, `apply()`, `tailor workflow run`, and `tailor tailordb migration test` now fail with `WORKFLOW_START_TARGET_OUTSIDE_FILES` when bundled code calls `.start()` on a workflow job or workflow that it imports from, or defines in, a file the workflow service's `files` does not include, including in a config without a workflow service. Before, the build left the call as it was, and it failed only when it ran after deploy. Add the file to `files` to fix it. Such a call in bundled code that never runs now fails the build too.
