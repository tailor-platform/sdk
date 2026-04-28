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
