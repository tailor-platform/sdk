import { createResolver, t } from "@tailor-platform/sdk";
// The bundler inlines the `.wasm` module as a `Uint8Array`. The function runtime
// cannot fetch `.wasm` files, so importing the bytes and instantiating them
// in-memory is the supported way to use WebAssembly. See docs/runtime.md.
import wasmBytes from "./add.wasm";

export default createResolver({
  name: "wasmAdd",
  description: "Addition performed by a bundled WebAssembly module",
  operation: "query",
  input: {
    a: t.int().description("First number to add"),
    b: t.int().description("Second number to add"),
  },
  body: async ({ input }) => {
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const add = instance.exports.add as (a: number, b: number) => number;
    return add(input.a, input.b);
  },
  output: t.int().description("Sum of the two input numbers, computed in WebAssembly"),
});
