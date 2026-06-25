import { afterEach, describe, expect, test, vi } from "vitest";

const nodeModuleMock = vi.hoisted(() => ({
  registerHooks: vi.fn(),
}));

vi.mock("node:module", () => nodeModuleMock);

import { registerTsHook } from "./register-ts-hook";

describe("registerTsHook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test("skips hook registration on Bun (native TypeScript runtime)", async () => {
    vi.stubGlobal("Bun", {});
    await registerTsHook(new URL("file:///ts-hook.mjs"));
    expect(nodeModuleMock.registerHooks).not.toHaveBeenCalled();
  });

  test("skips hook registration on Deno (native TypeScript runtime)", async () => {
    vi.stubGlobal("Deno", {});
    await registerTsHook(new URL("file:///ts-hook.mjs"));
    expect(nodeModuleMock.registerHooks).not.toHaveBeenCalled();
  });

  test("calls module.registerHooks() with resolve/load on Node.js", async () => {
    const tsHookUrl = new URL("../ts-hook.mjs", import.meta.url);
    await registerTsHook(tsHookUrl);
    expect(nodeModuleMock.registerHooks).toHaveBeenCalledWith({
      resolve: expect.any(Function),
      load: expect.any(Function),
    });
  });
});
