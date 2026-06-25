import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("node:module", () => ({ register: vi.fn() }));

import { registerTsHook } from "./register-ts-hook";

describe("registerTsHook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test("skips hook registration on Bun (native TypeScript runtime)", async () => {
    vi.stubGlobal("Bun", {});
    const nodeModule = await import("node:module");
    await registerTsHook(new URL("file:///ts-hook.mjs"));
    expect(nodeModule.register).not.toHaveBeenCalled();
  });

  test("skips hook registration on Deno (native TypeScript runtime)", async () => {
    vi.stubGlobal("Deno", {});
    const nodeModule = await import("node:module");
    await registerTsHook(new URL("file:///ts-hook.mjs"));
    expect(nodeModule.register).not.toHaveBeenCalled();
  });
});
