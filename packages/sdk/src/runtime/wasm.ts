/**
 * Helpers for running WebAssembly inside Tailor Platform functions.
 *
 * The function runtime exposes the standard `WebAssembly` API but blocks the
 * `.wasm` fetch path that emscripten-generated glue relies on by default. Bundle
 * the wasm bytes into your function with a static import — the SDK bundler
 * inlines `.wasm` modules as a `Uint8Array` — and feed those bytes to the
 * runtime instead of letting the glue fetch a separate file.
 * @example
 * // Hand-written / low-level module: instantiate the inlined bytes directly.
 * import wasmBytes from "./add.wasm";
 *
 * const { instance } = await WebAssembly.instantiate(wasmBytes, {});
 * const add = instance.exports.add as (a: number, b: number) => number;
 * @example
 * // Emscripten-generated module: hand the bytes to the `instantiateWasm` hook
 * // so the glue never tries to fetch a separate `.wasm` file.
 * import { wasm } from "@tailor-platform/sdk/runtime";
 * import wasmBytes from "./module.wasm";
 * import createModule from "./module.js"; // emscripten glue
 *
 * const mod = await createModule({ instantiateWasm: wasm.instantiateWasmFromBytes(wasmBytes) });
 */

/**
 * Hook compatible with emscripten's `Module.instantiateWasm`. Receives the
 * import object the glue prepared and a success callback to invoke with the
 * instantiated module. Returning `{}` signals asynchronous instantiation.
 */
export type InstantiateWasmHook = (
  imports: WebAssembly.Imports,
  onSuccess: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
) => Record<string, never>;

/**
 * Build a `Module.instantiateWasm` hook that instantiates from in-memory bytes,
 * bypassing the runtime's blocked `.wasm` fetch path.
 *
 * Emscripten-generated modules call `Module.instantiateWasm(imports, success)`
 * when it is provided, delegating instantiation to the caller. Wiring this hook
 * stops the glue from fetching a separate `.wasm` file — which fails in the
 * Tailor function sandbox — and instantiates the bundled bytes instead.
 *
 * If instantiation fails (invalid or incompatible bytes), the error is re-thrown
 * as an unhandled rejection. Emscripten's hook has no failure channel, so this
 * surfaces the real error instead of letting the caller's module factory hang.
 * @param wasmBytes - The wasm module bytes, e.g. from `import bytes from "./mod.wasm"`.
 * @returns A function suitable for emscripten's `Module.instantiateWasm` option.
 */
export function instantiateWasmFromBytes(wasmBytes: BufferSource): InstantiateWasmHook {
  return (imports, onSuccess) => {
    WebAssembly.instantiate(wasmBytes, imports)
      .then((result) => {
        onSuccess(result.instance, result.module);
      })
      .catch((error) => {
        throw error;
      });
    return {};
  };
}
