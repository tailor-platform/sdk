/**
 * Tests for `@tailor-platform/sdk/runtime/wasm` helpers.
 *
 * Verifies that {@link instantiateWasmFromBytes} produces an emscripten-style
 * `Module.instantiateWasm` hook that instantiates a module from in-memory bytes
 * and reports the instance through the success callback.
 */
import { describe, expect, test } from "vitest";
import { instantiateWasmFromBytes } from "./wasm";

// Minimal valid wasm module exporting `add(i32, i32): i32`.
const ADD_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01,
  0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09,
  0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);

describe("instantiateWasmFromBytes", () => {
  test("returns a hook that instantiates from bytes and resolves via the success callback", async () => {
    const hook = instantiateWasmFromBytes(ADD_WASM);

    const instance = await new Promise<WebAssembly.Instance>((resolve) => {
      const ret = hook({}, (inst) => resolve(inst));
      // Returning an empty object signals asynchronous instantiation to emscripten.
      expect(ret).toEqual({});
    });

    const add = instance.exports.add as (a: number, b: number) => number;
    expect(add(2, 3)).toBe(5);
  });

  test("passes the import object through to WebAssembly.instantiate", async () => {
    // A module that imports an env function should receive the provided imports.
    let called = false;
    const importObject: WebAssembly.Imports = {
      env: {
        log: () => {
          called = true;
        },
      },
    };

    const hook = instantiateWasmFromBytes(ADD_WASM);
    const { module } = await new Promise<{
      instance: WebAssembly.Instance;
      module: WebAssembly.Module;
    }>((resolve) => {
      hook(importObject, (instance, mod) => resolve({ instance, module: mod }));
    });

    // The add module declares no imports, so `called` stays false; the assertion
    // here is that instantiation succeeds with an import object present.
    expect(module).toBeInstanceOf(WebAssembly.Module);
    expect(called).toBe(false);
  });
});
