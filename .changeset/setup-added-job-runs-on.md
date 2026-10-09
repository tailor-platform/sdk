---
"@tailor-platform/sdk-plugin-setup": patch
---

When re-running `tailor setup` adds a managed job to an existing workflow, for example the ERD preview jobs when you add `--erd-preview`, the new job now uses the `runs-on` you set, such as self-hosted runners, instead of `ubuntu-latest`. This applies when every managed job already in the workflow uses the same `runs-on`; otherwise, set it on the new job yourself.
