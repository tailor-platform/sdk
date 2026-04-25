---
"@tailor-platform/sdk": patch
"@tailor-platform/create-sdk": patch
---

Revamp `packages/sdk/docs/testing.md` into a 2-layer model (Unit Tests / E2E Tests). The previous structure split Unit, Bundled, and Workflow tests across overlapping sections and contained broken vitest imports and references to a non-existent `--template testing`. The new docs cover testing resolvers (simple, with TailorDB mocks, with DI, and with wait points) and workflow jobs (simple, with `triggerJobFunction` mocks, with wait-point mocks, and full-workflow integration), all anchored on the actual `resolver` and `workflow` templates.

Mark `createImportMain` from `@tailor-platform/sdk/test` as `@deprecated`. It is an SDK-internal helper for verifying bundled output; applications should test their TypeScript source directly (unit) and verify deployed behavior via E2E. The export remains in place for now to avoid a breaking change and will be removed in a future release.

Remove the broken `tests/bundled.test.ts` from the `resolver` and `workflow` templates along with the related `bundled` vitest project and `test:bundled` / `test:bundled:prepare` scripts. These tests were not exercised by CI and had drifted out of sync with the SDK, producing failures on a fresh scaffold. Closes tailor-inc/platform-planning#1136.
