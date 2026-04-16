---
"@tailor-platform/sdk": minor
---

Add `@tailor-platform/sdk/vitest` (beta) — a Vitest plugin and environment that emulates the Tailor Platform function runtime locally. Catches `node:*` imports and Node.js globals usage that would fail at deploy time, and provides mock control objects (`tailordbMock`, `workflowMock`, `secretmanagerMock`, `authconnectionMock`, `idpMock`, `fileMock`, `iconvMock`) for all platform APIs with response configuration and call recording.
