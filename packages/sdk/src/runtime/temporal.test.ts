import { describe, expect, test, vi } from "vitest";
import { Temporal } from "./temporal";

describe("Temporal runtime wrapper", () => {
  test("preserves runtime constructor identity", () => {
    expect(Temporal.PlainDate).toBe(globalThis.Temporal.PlainDate);
    expect(Temporal.Instant).toBe(globalThis.Temporal.Instant);
    expect(Temporal.PlainTime).toBe(globalThis.Temporal.PlainTime);
    expect(Temporal.Now).toBe(globalThis.Temporal.Now);
    expect(new Temporal.PlainDate(2026, 9, 16)).toBeInstanceOf(globalThis.Temporal.PlainDate);
  });

  test("resolves Temporal lazily without installing a polyfill", async () => {
    vi.stubGlobal("Temporal", undefined);
    try {
      const runtime = await import("./index");
      expect(globalThis.Temporal).toBeUndefined();
      expect(() => runtime.Temporal.PlainDate).toThrow(ReferenceError);
      expect(() => runtime.Temporal.Instant).toThrow("tailor-runtime Vitest environment");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(Temporal.PlainDate.from("2026-09-16").toString()).toBe("2026-09-16");
  });
});
