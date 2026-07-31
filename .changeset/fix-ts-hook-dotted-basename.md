---
"@tailor-platform/sdk": patch
---

Fix `tailor` CLI failing with `ERR_MODULE_NOT_FOUND` when resolving extensionless relative imports of files whose basename contains a dot (e.g. `./permissions.generated`).
