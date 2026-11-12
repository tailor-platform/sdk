---
"@tailor-platform/sdk": patch
---

Stop capping `metadata` at 17 entries in the SDK and follow the platform's label limit instead. A `metadata` that exceeds the limit is no longer rejected when the config is loaded; `deploy` fails with `DEPLOY_LABEL_LIMIT_EXCEEDED` carrying the platform's error after writing the SDK's own labels, which leaves the `metadata` entries unwritten.
