---
"@tailor-platform/sdk": patch
---

Align local input validation in `tailor function test-run` with deployed resolver behavior. A `null` input is now reported as `Required field is missing` instead of `Expected an object: received null`, matching the validation that runs on the platform.
