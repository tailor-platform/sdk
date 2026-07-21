import { afterEach, describe, expect, test, vi } from "vitest";

const nodeModuleMock = vi.hoisted(() => ({
  register: vi.fn(),
}));
const tsxRegisterMock = vi.hoisted(() => vi.fn());

vi.mock("node:module", () => nodeModuleMock);
vi.mock("tsx/esm/api", () => ({ register: tsxRegisterMock }));

import { registerTypeScriptRuntime } from "./register-typescript-runtime";

describe("registerTypeScriptRuntime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    nodeModuleMock.register = vi.fn();
  });

  test("skips tsx registration on Bun (native TypeScript runtime)", async () => {
    vi.stubGlobal("Bun", {});
    await registerTypeScriptRuntime(new URL("../tsconfig-paths-hook.mjs", import.meta.url));
    expect(tsxRegisterMock).not.toHaveBeenCalled();
    expect(nodeModuleMock.register).not.toHaveBeenCalled();
  });

  test("skips tsx registration on Deno (native TypeScript runtime)", async () => {
    vi.stubGlobal("Deno", {});
    await registerTypeScriptRuntime(new URL("../tsconfig-paths-hook.mjs", import.meta.url));
    expect(tsxRegisterMock).not.toHaveBeenCalled();
    expect(nodeModuleMock.register).not.toHaveBeenCalled();
  });

  test("registers tsx and the tsconfig paths hook together on Node.js", async () => {
    const hookUrl = new URL("../tsconfig-paths-hook.mjs", import.meta.url);
    await registerTypeScriptRuntime(hookUrl);
    expect(tsxRegisterMock).toHaveBeenCalledTimes(1);
    expect(nodeModuleMock.register).toHaveBeenCalledWith(hookUrl);
  });
});
