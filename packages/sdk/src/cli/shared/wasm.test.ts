/**
 * Tests for the `.wasm` bundling support in `@/cli/shared/wasm`.
 *
 * Covers the rolldown module-type mapping that inlines wasm into the single
 * bundled chunk, and the Node load hook that lets the CLI `await import()` user
 * source that statically imports a `.wasm` file.
 */
import { beforeAll, describe, expect, test, vi } from "vitest";

const registerHooksMock = vi.fn();

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, registerHooks: registerHooksMock };
});

const { FUNCTION_WASM_MODULE_TYPES, registerWasmModuleLoader } = await import("./wasm");

type LoadHook = (
  url: string,
  context: unknown,
  nextLoad: (url: string, context: unknown) => unknown,
) => { format?: string; source?: string; shortCircuit?: boolean };

describe("FUNCTION_WASM_MODULE_TYPES", () => {
  test("maps .wasm to the inlining `binary` module type", () => {
    expect(FUNCTION_WASM_MODULE_TYPES).toEqual({ ".wasm": "binary" });
  });
});

describe("registerWasmModuleLoader", () => {
  let load: LoadHook;

  beforeAll(() => {
    // Register once and capture the hook so each test is independent of order
    // (the module-level guard means only the first call registers).
    registerWasmModuleLoader();
    load = (registerHooksMock.mock.calls[0][0] as { load: LoadHook }).load;
  });

  test("registers the load hook exactly once, even across repeated calls", () => {
    registerWasmModuleLoader(); // no-op: already registered
    expect(registerHooksMock).toHaveBeenCalledTimes(1);
  });

  test("resolves .wasm urls to a Uint8Array module and delegates everything else", () => {
    const next = vi.fn(() => ({ format: "module", source: "delegated" }));

    const wasmResult = load("file:///tmp/example/add.wasm", {}, next);
    expect(wasmResult.format).toBe("module");
    expect(wasmResult.shortCircuit).toBe(true);
    expect(wasmResult.source).toContain("readFileSync");
    expect(wasmResult.source).toContain("Uint8Array");
    expect(wasmResult.source).toContain("/tmp/example/add.wasm");
    expect(next).not.toHaveBeenCalled();

    const tsResult = load("file:///tmp/example/index.ts", {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(tsResult).toEqual({ format: "module", source: "delegated" });
  });
});
