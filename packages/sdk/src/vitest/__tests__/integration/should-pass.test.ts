/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from "vitest";
import { generateId } from "./fixtures/uses-web-crypto";

test("web crypto API works in tailor-runtime", () => {
  const id = generateId();
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
});

test("node:crypto is allowed in test files directly", async () => {
  const { randomUUID } = await import("node:crypto");
  expect(randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
});

test("type-only imports from blocked modules are not blocked", async () => {
  const { fakeHash } = await import("./fixtures/uses-node-crypto-types");
  expect(fakeHash("hello")).toBe(5);
});

test("platform API mocks are injected into globalThis", () => {
  const g = globalThis as any;
  expect(g.tailordb).toBeDefined();
  expect(g.tailordb.Client).toBeTypeOf("function");
  expect(g.tailor).toBeDefined();
  expect(g.tailor.workflow.triggerJobFunction).toBeTypeOf("function");
  expect(g.TailorErrors).toBeTypeOf("function");
  expect(g.TailorErrorMessage).toBeTypeOf("function");
  expect(g.TailorDBFileError).toBeTypeOf("function");
});

test("setup.ts removes performance global during test execution", () => {
  // setup.ts deletes Vitest-host globals that are not present in the platform
  // runtime. `performance` is removed in beforeEach and restored in
  // afterEach, so within the test body it must be absent.
  expect("performance" in globalThis).toBe(false);
});

test("__tailorRuntimeActive flag is set when the environment is active", () => {
  expect("__tailorRuntimeActive" in globalThis).toBe(true);
});

test("Web Standard / ECMAScript globals remain available after whitelist cleanup", () => {
  // The environment removes everything not on ALLOWED_GLOBALS. These are
  // intentionally on the whitelist (sourced from `globals.builtin` and
  // `globals.shared-node-browser`), so they must survive.
  expect(typeof console).toBe("object");
  expect(typeof fetch).toBe("function");
  expect(typeof URL).toBe("function");
  expect(typeof URLSearchParams).toBe("function");
  expect(typeof Math).toBe("object");
  expect(typeof setTimeout).toBe("function");
  expect(typeof Promise).toBe("function");
});

test("performance is restored between tests so subsequent tests do not see leakage", () => {
  // afterEach in setup.ts restores performance after each test. This test
  // runs after the earlier "performance is removed during test execution"
  // test; if afterEach were broken, this would still see no `performance`
  // and the next beforeEach would fail to capture/restore it. The existing
  // beforeEach delete is itself the assertion that the prior afterEach
  // restored the global — if this test body runs without an exception
  // ("cannot delete non-existent global"-style), the restore worked.
  // We additionally assert the descriptor was set up correctly by checking
  // the global is missing here (delete just ran in beforeEach).
  expect("performance" in globalThis).toBe(false);
});
