import { afterEach, describe, expect, test, vi } from "vitest";

const nodeModuleMock = vi.hoisted(() => ({
  register: vi.fn(),
}));

vi.mock("node:module", () => nodeModuleMock);

import { registerTsconfigPathsHook } from "./register-tsconfig-paths-hook";

describe("registerTsconfigPathsHook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    nodeModuleMock.register = vi.fn();
  });

  test("skips hook registration on Bun (native TypeScript runtime)", async () => {
    vi.stubGlobal("Bun", {});
    await registerTsconfigPathsHook(new URL("file:///tsconfig-paths-hook.mjs"));
    expect(nodeModuleMock.register).not.toHaveBeenCalled();
  });

  test("skips hook registration on Deno (native TypeScript runtime)", async () => {
    vi.stubGlobal("Deno", {});
    await registerTsconfigPathsHook(new URL("file:///tsconfig-paths-hook.mjs"));
    expect(nodeModuleMock.register).not.toHaveBeenCalled();
  });

  test("skips registration when module.register is unavailable on this Node.js version", async () => {
    nodeModuleMock.register = undefined as unknown as typeof nodeModuleMock.register;
    const hookUrl = new URL("../tsconfig-paths-hook.mjs", import.meta.url);
    await expect(registerTsconfigPathsHook(hookUrl)).resolves.toBeUndefined();
  });

  test("calls module.register() with the hook URL on Node.js", async () => {
    const hookUrl = new URL("../tsconfig-paths-hook.mjs", import.meta.url);
    await registerTsconfigPathsHook(hookUrl);
    expect(nodeModuleMock.register).toHaveBeenCalledWith(hookUrl);
  });
});
