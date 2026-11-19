---
"@tailor-platform/sdk": minor
---

Leave the number of `metadata` entries to the platform's limit on labels per application instead of capping it in the SDK. A config with more than 17 entries now loads, and `deploy` no longer counts the application's labels before it changes anything, so `deploy --dry-run` does not report an overflow. When the platform rejects the labels for their count, `deploy` writes the SDK's own labels without the `metadata` entries, applies the rest of its changes, and then fails with `DEPLOY_LABEL_LIMIT_EXCEEDED`, naming the entries it did not write.
