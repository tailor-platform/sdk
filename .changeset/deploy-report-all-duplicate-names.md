---
"@tailor-platform/sdk": patch
---

When `tailor deploy` is given multiple configs that define the same resource name, the `DEPLOY_DUPLICATE_RESOURCE_NAME` error now lists every duplicate in one run, each with its resource type, name, and the config files that define it, instead of stopping at the first one. With `--json`, the duplicates are also available in `error.context.duplicates`.
