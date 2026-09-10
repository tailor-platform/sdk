/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from "vitest";
import { mockTailordb, mockWorkflow } from "../mock";
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

test("base platform globals are injected; namespace mocks install on acquire", () => {
  using _db = mockTailordb();
  using _wf = mockWorkflow();
  const g = globalThis as any;
  // Base surface (always present under the tailor-runtime environment).
  expect(g.tailor).toBeDefined();
  expect(g.tailordb).toBeDefined();
  expect(g.tailor.context.getInvoker).toBeTypeOf("function");
  expect(g.TailorErrors).toBeTypeOf("function");
  expect(g.TailorDBFileError).toBeTypeOf("function");
  // Namespace mocks are installed once the corresponding mock is acquired.
  expect(g.tailordb.Client).toBeTypeOf("function");
  expect(g.tailor.workflow.execJobFunction).toBeTypeOf("function");
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
