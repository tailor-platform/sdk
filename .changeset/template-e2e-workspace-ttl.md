---
"@tailor-platform/create-sdk": patch
---

Record a 24-hour expiry on the workspace that the workflow template's e2e `globalSetup.ts` creates, so `tailor workspace prune --expired` can reclaim it when a run is interrupted before its teardown. When the expiry cannot be recorded, the setup deletes the workspace and fails instead of leaving one that nothing reclaims. Projects scaffolded earlier keep their existing `globalSetup.ts`; add `ttl: "24h"` to its `createWorkspace` call, and delete the workspace and throw when the returned `ttl.state` is `"unconfirmed"`, to get the same behavior.
