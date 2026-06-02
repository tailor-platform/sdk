---
"@tailor-platform/sdk": minor
---

feat(vitest): expose mock controllers as `using`-friendly factories (Beta, breaking)

The mock controllers from `@tailor-platform/sdk/vitest` are renamed from
noun-style singleton objects (`tailordbMock`, `workflowMock`, …) to verb-style
**factory functions** (`mockTailordb`, `mockWorkflow`, `mockSecretmanager`,
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

Internally the mocks are now `vi.fn()`-backed: the friendly helpers wrap
`vi.fn()`s that are also exposed directly (e.g. `db.queryObject`,
`wf.triggerJobFunction`) so native matchers like
`expect(wf.triggerJobFunction).toHaveBeenCalledWith(...)` work too. There is no
longer a shared global state bag — each acquisition installs its namespace's
mocks onto `globalThis` and restores the previous state on dispose, so
namespaces and nested scopes are isolated.

Because a namespace's mock is installed on acquisition, code under test that
calls a platform API (e.g. `tailor.workflow`, `tailordb.Client`) must run inside
a test that acquired the matching `xMock()`. The base surface
(`tailor.context`, the error classes) is always present. `mockSecretmanager()`
inherits the currently-installed secret store on acquisition and restores it on
dispose, so secrets seeded from `tailor.config.ts` survive across `using`
scopes while per-test `setSecrets()` overrides stay isolated.

This is a breaking change to the **Beta** `tailor-runtime` testing API. `using`
requires TypeScript ≥ 5.2 and a runtime that provides `Symbol.dispose`
(Node ≥ 20.4; the SDK already targets Node ≥ 22, and Vitest's transformer
downlevels the syntax).
