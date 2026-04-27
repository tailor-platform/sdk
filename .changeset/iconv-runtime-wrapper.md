---
"@tailor-platform/sdk": minor
---

Add `@tailor-platform/sdk/iconv` runtime wrapper for character encoding conversion. Exports typed `convert`, `convertBuffer`, `decode`, `encode`, `encodings`, and `Iconv` class that delegate to the platform's `tailor.iconv` runtime API. Use `setupIconvMock()` from `@tailor-platform/sdk/test` to mock these calls in unit tests.
