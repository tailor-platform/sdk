---
"@tailor-platform/sdk": patch
---

Fix `tailor-sdk api` injecting a duplicate `workspaceId` when `--body` supplies the field in snake_case. The auto-injection guard only checked the camelCase key, so a body such as `{"workspace_id": "..."}` slipped past it and the SDK appended a second `workspaceId`, which the server rejected with a duplicate-field error. Body keys are now converged to each field's canonical (camelCase) name before injection, so snake_case and JSON aliases are recognized.
