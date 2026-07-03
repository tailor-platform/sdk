---
"@tailor-platform/sdk": minor
---

Add `tailor-sdk setup delete <file...>` to cleanly remove generated CI workflow/action files together with their `.github/tailor-sdk.lock` entries. It only deletes files recorded in the lock, warns when an action is still referenced by a `setup coordinate` workflow, and removes the composite action's directory once it is empty.
