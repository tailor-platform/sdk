/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from "vitest";
import { t } from "../../configure/types/type";
import { serializeDateFields } from "../../runtime/date";
import { Temporal } from "../../runtime/temporal";
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

test("Temporal is available in the platform environment without Node flags", () => {
  expect(typeof Temporal).toBe("object");
  expect(Temporal.PlainDate.from("2026-09-15").toString()).toBe("2026-09-15");
  expect(Temporal.Instant.from("2026-09-15T00:00:00+09:00").toString()).toBe(
    "2026-09-14T15:00:00Z",
  );
  expect(Temporal.PlainTime.from("12:30").toString({ smallestUnit: "minute" })).toBe("12:30");
});

test("Temporal fields parse and serialize through the environment implementation", () => {
  const fields = t.object({
    day: t.date({ as: "temporal" }),
    at: t.datetime({ as: "temporal" }),
    time: t.time({ as: "temporal" }),
  });
  const input = { day: "2026-09-16", at: "2026-09-16T00:00:00Z", time: "23:59" };
  const result = fields.parse({ value: input, data: input, invoker: null });
  if (result.issues) throw new Error(JSON.stringify(result.issues));
  expect(result.value.day).toBeInstanceOf(Temporal.PlainDate);
  expect(result.value.at).toBeInstanceOf(Temporal.Instant);
  expect(result.value.time).toBeInstanceOf(Temporal.PlainTime);
  result.value.time = result.value.time.with({ second: 59, millisecond: 999 });
  expect(serializeDateFields(fields, result.value)).toEqual(input);
  expect(
    t.date({ as: "temporal" }).parse({ value: "2026-02-30", data: {}, invoker: null }),
  ).toHaveProperty("issues");
  expect(() =>
    serializeDateFields(t.date({ as: "temporal" }), Temporal.PlainDate.from("+010000-01-01")),
  ).toThrow("4-digit year");
});
