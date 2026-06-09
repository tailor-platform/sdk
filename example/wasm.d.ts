// Type the `import bytes from "./mod.wasm"` pattern. The SDK bundler inlines
// `.wasm` modules into function-runtime code as a `Uint8Array`. Projects add
// this ambient declaration themselves (see packages/sdk/docs/runtime.md).
declare module "*.wasm" {
  // `Uint8Array<ArrayBuffer>` (not bare `Uint8Array`) so the bytes satisfy
  // `BufferSource` on TypeScript >= 5.7, where typed arrays became generic.
  const bytes: Uint8Array<ArrayBuffer>;
  export default bytes;
}
