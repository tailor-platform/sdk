---
"@tailor-platform/sdk": patch
---

`tailor deploy` now prints the plan before asking to confirm deletions, owner conflicts, unmanaged resources, missing dependent applications, or migration checkpoint resets, so you answer each confirmation with the whole plan in view. When `env` references the URL of a static website the same deploy creates, `deploy` prints the plan it makes again with the real URL and asks only about what that plan adds.
