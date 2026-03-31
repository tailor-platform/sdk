---
"@tailor-platform/sdk": minor
---

Add `@tailor-platform/sdk/vitest` — a Vitest plugin and environment that emulates the Tailor Platform function runtime locally. Catches `node:*` imports and Node.js globals usage that would fail at deploy time, and provides `tailordbMock`/`workflowMock` for testing resolvers, executors, and workflows without manual setup.
