---
"@tailor-platform/sdk": patch
---

Isolate the SDK test suite (every vitest project except e2e) from TAILOR_\* environment variables exported by the developer's shell, so tests pass regardless of local CLI configuration.
