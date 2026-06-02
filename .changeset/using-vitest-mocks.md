---
"@tailor-platform/sdk": minor
---

feat(vitest)!: rename mock controllers to verb-style `mockX()` factories (Beta)

The `@tailor-platform/sdk/vitest` mock controllers are renamed from noun-style
singleton objects (`tailordbMock`, `workflowMock`, …) to verb-style **factory
functions** (`mockTailordb`, `mockWorkflow`, `mockSecretmanager`,
`mockAuthconnection`, `mockIdp`, `mockFile`, `mockIconv`). Acquire one with a
`using` declaration and its state is reset automatically when the test scope
exits — no more `beforeEach(() => mock.reset())`.

```diff
-import { tailordbMock } from "@tailor-platform/sdk/vitest";
-
-beforeEach(() => tailordbMock.reset());
-
 test("...", () => {
-  tailordbMock.enqueueResult({ age: 30 });
-  expect(tailordbMock.executedQueries).toHaveLength(1);
+  using db = mockTailordb();
+  db.enqueueResult({ age: 30 });
+  expect(db.executedQueries).toHaveLength(1);
 });
```

This is a breaking change to the **Beta** `tailor-runtime` testing API. `using`
requires TypeScript ≥ 5.2 and a runtime that provides `Symbol.dispose`
(Node ≥ 20.4; the SDK already targets Node ≥ 22, and Vitest's transformer
downlevels the syntax).
