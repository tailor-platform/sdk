---
"@tailor-platform/sdk": minor
---

feat(vitest): expose mock controllers as `using`-friendly factories (Beta, breaking)

The mock controllers from `@tailor-platform/sdk/vitest` (`tailordbMock`,
`workflowMock`, `secretmanagerMock`, `authconnectionMock`, `idpMock`,
`fileMock`, `iconvMock`) are now **factory functions** instead of singleton
objects. Acquire one with a `using` declaration and its state is reset
automatically when the test scope exits — no more `beforeEach(() => mock.reset())`.

```diff
-import { tailordbMock } from "@tailor-platform/sdk/vitest";
-
-beforeEach(() => tailordbMock.reset());
-
 test("...", () => {
-  tailordbMock.enqueueResult({ age: 30 });
-  expect(tailordbMock.executedQueries).toHaveLength(1);
+  using db = tailordbMock();
+  db.enqueueResult({ age: 30 });
+  expect(db.executedQueries).toHaveLength(1);
 });
```

Acquisition does not reset state, so secrets seeded from `tailor.config.ts`
survive until the `using` scope is disposed.

This is a breaking change to the **Beta** `tailor-runtime` testing API. `using`
requires TypeScript ≥ 5.2 and a runtime that provides `Symbol.dispose`
(Node ≥ 20.4; the SDK already targets Node ≥ 22, and Vitest's transformer
downlevels the syntax).
