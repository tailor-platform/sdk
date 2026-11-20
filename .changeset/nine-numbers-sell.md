---
"@tailor-platform/sdk": patch
---

`tailor deploy` now rewrites the SDK labels of a resource whose configuration is unchanged when they differ from the ones the deploy sets, such as the application name label after renaming an application that keeps its id. Only the labels are written. Workflow job functions still get their labels only when their workflow is created or updated. The plan summary's `labelRefreshes` now counts these resources, apart from TailorDB tables and resolvers, instead of only function scripts.
