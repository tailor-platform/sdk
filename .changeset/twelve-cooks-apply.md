---
"@tailor-platform/sdk": minor
---

Allow `tailor-sdk deploy --config` to accept comma-separated config paths so interdependent apps can be deployed together. Executor, workflow job, and application names must be unique across all configs passed to a single deploy, and resources still owned by another config in the same deploy are no longer deleted.
