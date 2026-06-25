import { afterEach, describe, expect, test, vi } from "vitest";

const nodeModuleMock = vi.hoisted(() => ({
  register: vi.fn(),
  registerHooks: undefined as ((opts: { resolve?: unknown; load?: unknown }) => void) | undefined,
}));

vi.mock("node:module", () => nodeModuleMock);
vi.mock("../ts-hook.mjs", () => ({ resolveSync: vi.fn(), loadSync: vi.fn() }));

import { registerTsHook } from "./register-ts-hook";

describe("registerTsHook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    nodeModuleMock.registerHooks = undefined;
  });

  test("skips hook registration on Bun (native TypeScript runtime)", async () => {
    vi.stubGlobal("Bun", {});
    await registerTsHook(new URL("file:///ts-hook.mjs"));
    expect(nodeModuleMock.register).not.toHaveBeenCalled();
  });

  test("skips hook registration on Deno (native TypeScript runtime)", async () => {
    vi.stubGlobal("Deno", {});
    await registerTsHook(new URL("file:///ts-hook.mjs"));
    expect(nodeModuleMock.register).not.toHaveBeenCalled();
  });

  test("calls module.register() on Node.js when registerHooks is unavailable", async () => {
    const tsHookUrl = new URL("../ts-hook.mjs", import.meta.url);
    await registerTsHook(tsHookUrl);
    expect(nodeModuleMock.register).toHaveBeenCalledWith(tsHookUrl, expect.any(String));
  });

  test("calls module.registerHooks() with resolve/load when registerHooks is present", async () => {
    const registerHooks = vi.fn();
    nodeModuleMock.registerHooks = registerHooks;
    const tsHookUrl = new URL("../ts-hook.mjs", import.meta.url);
    await registerTsHook(tsHookUrl);
    expect(registerHooks).toHaveBeenCalledWith({
      resolve: expect.any(Function),
      load: expect.any(Function),
    });
  });
});
