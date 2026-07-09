---
"@tailor-platform/sdk": patch
---

Remove the `openDownloadStream` method from `mockFile()` (`@tailor-platform/sdk/vitest`), matching the runtime file API, which no longer exposes it. Use `downloadStream` instead.
