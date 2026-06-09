---
"@tailor-platform/sdk": minor
---

Support WebAssembly in function-runtime code (executors, resolvers, workflow jobs, auth hooks, TailorDB hooks, and HTTP adapters). A statically imported `.wasm` file (`import bytes from "./mod.wasm"`) is now inlined into the bundled code as a `Uint8Array`, so it can be instantiated in-memory with `WebAssembly.instantiate(bytes)` — the runtime cannot fetch `.wasm` files, so the previous fetch-based loading failed. The new `wasm.instantiateWasmFromBytes()` helper from `@tailor-platform/sdk/runtime` wires inlined bytes into emscripten's `Module.instantiateWasm` hook so prebuilt wasm libraries work without runtime fetches. See [runtime docs](https://github.com/tailor-platform/sdk/blob/main/packages/sdk/docs/runtime.md) for usage, constraints, and the ambient `*.wasm` type declaration to add to your project.
