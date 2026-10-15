---
"@tailor-platform/create-sdk": patch
---

Record a 24-hour expiry on the workspace that the workflow template's e2e `globalSetup.ts` creates, so `tailor workspace prune --expired` can reclaim it when a run is interrupted before its teardown. Projects scaffolded earlier keep their existing `globalSetup.ts`; add `ttl: "24h"` to its `createWorkspace` call to get the same expiry.
