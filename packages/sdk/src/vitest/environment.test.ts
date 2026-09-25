import { describe, expect, test } from "vitest";
import environment from "./environment";

// Use a separate global object so environment cleanup cannot affect Vitest itself.
function createGlobal(): typeof globalThis {
  return {} as typeof globalThis;
}

describe("tailor-runtime Temporal", () => {
  test("installs a full polyfill when Temporal is absent and removes it on teardown", async () => {
    const global = createGlobal();
    const lifecycle = await environment.setup(global);
    try {
      const temporal = global.Temporal;
      expect(temporal.PlainDate.from("2026-09-16").withCalendar("hebrew").calendarId).toBe(
        "hebrew",
      );
      expect(temporal.Instant.from("2026-09-16T00:00:00+09:00").toString()).toBe(
        "2026-09-15T15:00:00Z",
      );
      expect(temporal.PlainTime.from("23:59:59.999999999").hour).toBe(23);
    } finally {
      lifecycle.teardown(global);
    }
    expect(Object.hasOwn(global, "Temporal")).toBe(false);
  });

  test("preserves an existing Temporal implementation and its descriptor", async () => {
    const global = createGlobal();
    const descriptor = {
      value: globalThis.Temporal,
      configurable: true,
      writable: false,
      enumerable: false,
    };
    Object.defineProperty(global, "Temporal", descriptor);
    const lifecycle = await environment.setup(global);
    try {
      expect(global.Temporal).toBe(globalThis.Temporal);
      expect(Object.getOwnPropertyDescriptor(global, "Temporal")).toEqual(descriptor);
    } finally {
      lifecycle.teardown(global);
    }
    expect(Object.getOwnPropertyDescriptor(global, "Temporal")).toEqual(descriptor);
  });

  test("restores an existing undefined Temporal property", async () => {
    const global = createGlobal();
    const descriptor = { value: undefined, configurable: true, writable: true, enumerable: true };
    Object.defineProperty(global, "Temporal", descriptor);
    const lifecycle = await environment.setup(global);
    try {
      expect(global.Temporal.PlainDate.from("2026-09-16").toString()).toBe("2026-09-16");
    } finally {
      lifecycle.teardown(global);
    }
    expect(Object.getOwnPropertyDescriptor(global, "Temporal")).toEqual(descriptor);
  });
});
