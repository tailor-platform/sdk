---
"@tailor-platform/sdk": major
"@tailor-platform/create-sdk": patch
---

Raise the minimum supported Node.js version to 22 (declared via `engines.node`). Consumers running Node 18 or 20 must upgrade. The new Vitest plugin uses Node 22+ APIs (e.g. `path.matchesGlob`), and the SDK build target is now `node22`.

Add `@tailor-platform/sdk/vitest` (beta) — a Vitest plugin and environment that emulates the Tailor Platform function runtime locally. Catches `node:*` imports and Node.js globals usage that would fail at deploy time, and provides mock control objects (`tailordbMock`, `workflowMock`, `secretmanagerMock`, `authconnectionMock`, `idpMock`, `fileMock`, `iconvMock`) for all platform APIs with response configuration and call recording.

Revamp `packages/sdk/docs/testing.md` into a 2-layer model (Unit Tests / E2E Tests). The previous structure split Unit, Bundled, and Workflow tests across overlapping sections and contained broken vitest imports and references to a non-existent `--template testing`. The new docs cover testing resolvers (simple, with TailorDB mocks, with DI, and with wait points) and workflow jobs (simple, with `triggerJobFunction` mocks, with wait-point mocks, and full-workflow integration), all anchored on the actual `resolver` and `workflow` templates.

Mark `createImportMain` and `setupInvokerMock` from `@tailor-platform/sdk/test` as `@deprecated`. `createImportMain` is an SDK-internal helper for verifying bundled output; applications should test their TypeScript source directly (unit) and verify deployed behavior via E2E. `setupInvokerMock` is superseded by the `tailor-runtime` Vitest environment, where bundled tests can drive the invoker via `vi.spyOn(globalThis.tailor.context, "getInvoker").mockReturnValue(...)` and unit tests can pass `invoker` directly to `.body()`. Both exports remain in place for now to avoid a breaking change and will be removed in a future release.

Remove the broken `tests/bundled.test.ts` from the `resolver` and `workflow` templates along with the related `bundled` vitest project and `test:bundled` / `test:bundled:prepare` scripts. These tests were not exercised by CI and had drifted out of sync with the SDK, producing failures on a fresh scaffold.

Fix a broken anchor in `docs/services/workflow.md` that pointed at the removed `#testing-wait-points` heading; it now links to `../testing.md#jobs-that-wait-on-approval` to match the new testing docs structure.
