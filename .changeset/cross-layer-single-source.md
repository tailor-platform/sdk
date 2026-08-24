---
"@tailor-platform/sdk": patch
---

Internal refactoring: the wait point key rules and the platform runtime globals allowlist each moved to a single definition shared by validation and the test-runtime emulation. Accepted keys, error messages, and the emulated runtime surface are unchanged.
