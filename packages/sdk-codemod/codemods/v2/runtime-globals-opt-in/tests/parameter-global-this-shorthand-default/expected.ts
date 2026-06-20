import "@tailor-platform/sdk/runtime/globals";

function read({ tailor = fallback } = globalThis, { tailordb = fallbackDb } = globalThis) {
  return { tailor, tailordb };
}

export { read };
