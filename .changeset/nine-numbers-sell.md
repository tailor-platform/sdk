---
"@tailor-platform/sdk": patch
---

`tailor deploy` now rewrites the SDK labels of a resource whose configuration is unchanged when they differ from what the deploy sets, such as the application name label after renaming an application that keeps its id. Only the labels are written, and the plan summary's `labelRefreshes` now counts these resources of every kind, not only function scripts.
