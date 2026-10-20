---
"@tailor-platform/sdk": patch
---

Revert "fix(deps): update dependency rolldown to v1.2.14"

rolldown 1.2.14 can emit a malformed source map (a negative source line) for bundled functions, which can crash the platform runtime on debug builds while source-mapping a thrown error's stack trace. Downgrade to 1.2.13 as a temporary measure until the rolldown regression is resolved.
