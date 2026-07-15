import { describe, expect, test } from "vitest";
import { createVirtualEntry } from "./virtual-entry";

describe("createVirtualEntry", () => {
  test("resolves the root entry input", async () => {
    const entry = createVirtualEntry("resolver:test", "export const value = 1;");
    const resolveId = entry.plugin.resolveId as unknown as (
      source: string,
      importer?: string,
    ) => unknown;

    expect(await resolveId(entry.input)).toBe(`\0${entry.input}`);
  });

  test("does not intercept the same specifier imported by user code", async () => {
    const entry = createVirtualEntry("resolver:test", "export const value = 1;");
    const resolveId = entry.plugin.resolveId as unknown as (
      source: string,
      importer?: string,
    ) => unknown;

    expect(await resolveId(entry.input, "/project/resolver.ts")).toBeNull();
  });
});
