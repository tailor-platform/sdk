---
"@tailor-platform/sdk": minor
---

Add test utilities for bundled function testing via `@tailor-platform/sdk/test`

- `setupTailordbMock(resolver?)`: Mock `globalThis.tailordb.Client` for testing resolvers/executors that use DB queries
- `setupWorkflowMock(handler)`: Mock `globalThis.tailor.workflow.triggerJobFunction` for testing workflow job triggers
- `createImportMain(baseDir)`: Import bundled JS files and extract the `main` function for execution testing
