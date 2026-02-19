---
"@tailor-platform/sdk": minor
---

Use Function Registry service for script storage instead of embedding bundled scripts directly in pipeline/executor/workflow requests. Scripts are now registered in the Function Registry during apply, and services reference them by name via operationSourceRef/scriptRef fields.
