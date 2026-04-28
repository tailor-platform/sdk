/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from "vitest";
import { createBlockPlugin } from "../plugin";

function transformWith(plugin: ReturnType<typeof createBlockPlugin>, code: string, id: string) {
  (plugin.configResolved as any)({ test: { include: [] } });
  return (plugin.transform as any).call({}, code, id);
}

describe("createBlockPlugin", () => {
  test("replaces a blocked import with a throwing statement", () => {
    const plugin = createBlockPlugin();
    const result = transformWith(
      plugin,
      `import { randomUUID } from "node:crypto";`,
      "/src/file.ts",
    );
    expect(result.code).toMatch(/throw new Error\(/);
    expect(result.code).not.toContain('"node:crypto"');
  });

  test("preserves a preceding `export const` when followed by a blocked import", () => {
    const plugin = createBlockPlugin();
    const result = transformWith(
      plugin,
      `import { foo } from "@tailor-platform/sdk";

export const config = { version: 1 };

import { randomUUID } from "node:crypto";`,
      "/src/file.ts",
    );
    expect(result.code).toContain("export const config = { version: 1 };");
    expect(result.code).toContain('import { foo } from "@tailor-platform/sdk"');
    expect(result.code).toMatch(/throw new Error\(/);
  });

  test("preserves a preceding `export const` with a quoted value", () => {
    const plugin = createBlockPlugin();
    const result = transformWith(
      plugin,
      `export const x = "hello";
import { z } from "node:crypto";`,
      "/src/file.ts",
    );
    expect(result.code).toContain('export const x = "hello";');
    expect(result.code).toMatch(/throw new Error\(/);
  });

  test("preserves multi-line destructuring import of a blocked module as a single match", () => {
    const plugin = createBlockPlugin();
    const result = transformWith(
      plugin,
      `import {
  randomUUID,
  randomBytes,
} from "node:crypto";`,
      "/src/file.ts",
    );
    expect(result.code).toMatch(/throw new Error\(/);
    expect(result.code).not.toContain("randomUUID");
  });

  test("handles re-exports from blocked modules", () => {
    const plugin = createBlockPlugin();
    const result = transformWith(plugin, `export { foo } from "node:crypto";`, "/src/file.ts");
    expect(result.code).toMatch(/throw new Error\(/);
  });

  test("handles bare imports of blocked modules", () => {
    const plugin = createBlockPlugin();
    const result = transformWith(plugin, `import "node:crypto";`, "/src/file.ts");
    expect(result.code).toMatch(/throw new Error\(/);
  });

  test("handles multiple imports on a single line", () => {
    const plugin = createBlockPlugin();
    const result = transformWith(
      plugin,
      `import { a } from "@x"; import { b } from "node:fs";`,
      "/src/file.ts",
    );
    expect(result.code).toContain('import { a } from "@x"');
    expect(result.code).toMatch(/throw new Error\(/);
  });

  test("does not transform when no blocked imports are present", () => {
    const plugin = createBlockPlugin();
    const result = transformWith(
      plugin,
      `import { foo } from "@tailor-platform/sdk";
export const x = 1;`,
      "/src/file.ts",
    );
    expect(result).toBeUndefined();
  });
});
