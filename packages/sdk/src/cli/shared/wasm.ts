import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";
import type { ModuleTypes } from "rolldown";

/**
 * rolldown `moduleTypes` mapping that inlines imported `.wasm` files into the
 * bundled function code as a `Uint8Array`.
 *
 * The Tailor Platform function runtime exposes the standard `WebAssembly` API
 * but blocks the `.wasm` fetch path that emscripten-style glue relies on, and
 * the deploy pipeline ships only the single primary JS chunk — any separately
 * emitted `.wasm` asset is discarded. Decoding the module to an inlined
 * `Uint8Array` lets user code `import bytes from "./mod.wasm"` and instantiate
 * it in-memory with `WebAssembly.instantiate(bytes)`, matching how single-bundle
 * runtimes (Cloudflare Workers, Vercel Edge, Deno) embed wasm.
 */
export const FUNCTION_WASM_MODULE_TYPES: ModuleTypes = {
  ".wasm": "binary",
};

let wasmLoaderRegistered = false;

/**
 * Register a Node module hook so that dynamic `import()` of a `.wasm` file
 * resolves to its bytes as a `Uint8Array` default export.
 *
 * The CLI loads user config/executor/resolver/workflow source via `tsx`
 * (`await import(...)`) to inspect their exports. When that source statically
 * imports a `.wasm` file, the default loader tries to parse the binary as
 * JavaScript and throws. This hook short-circuits `.wasm` URLs to a synthetic
 * module that reads the file, mirroring {@link FUNCTION_WASM_MODULE_TYPES} so
 * the load phase and the bundled output agree on the import shape.
 *
 * Idempotent: only the first call registers the hook.
 *
 * `module.registerHooks` is available on Node >= 22.15 / 23.5 / 24. On older
 * runtimes still within the supported range (e.g. 22.14) it is undefined, so
 * registration is skipped there — the CLI still starts, but `.wasm` imports in
 * user source will not resolve until the runtime is upgraded.
 */
export function registerWasmModuleLoader(): void {
  if (wasmLoaderRegistered) return;

  const { registerHooks } = nodeModule;
  if (typeof registerHooks !== "function") return;

  wasmLoaderRegistered = true;

  registerHooks({
    load(url, context, nextLoad) {
      if (!url.endsWith(".wasm")) {
        return nextLoad(url, context);
      }
      const filePath = fileURLToPath(url);
      const source = [
        `import { readFileSync } from "node:fs";`,
        `export default new Uint8Array(readFileSync(${JSON.stringify(filePath)}));`,
      ].join("\n");
      return { format: "module", source, shortCircuit: true };
    },
  });
}
