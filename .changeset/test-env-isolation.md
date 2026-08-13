---
"@tailor-platform/sdk": patch
---

Isolate unit and integration tests from TAILOR_\* environment variables exported by the developer's shell, so the test suite passes regardless of local CLI configuration.
