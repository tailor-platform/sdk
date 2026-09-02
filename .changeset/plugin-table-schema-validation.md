---
"@tailor-platform/sdk": patch
---

Validate plugin-generated and plugin-extended TailorDB tables against the table schema. A malformed table emitted by a plugin now fails the build with an error naming the plugin and table instead of crashing or passing through unvalidated.
