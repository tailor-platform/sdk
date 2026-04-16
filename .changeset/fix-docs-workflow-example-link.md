---
"@tailor-platform/sdk": patch
---

Fix broken link to `example/resolvers/triggerWorkflow.ts` in the workflow service docs. The link used a relative path that escaped the `docs/` directory and 404'd on https://docs.tailor.tech; it now points to the GitHub source URL so it resolves on both the docs site and GitHub.
