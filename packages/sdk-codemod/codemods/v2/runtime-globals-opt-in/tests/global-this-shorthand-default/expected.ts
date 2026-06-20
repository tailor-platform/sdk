import "@tailor-platform/sdk/runtime/globals";

const { tailor = fallback } = globalThis;
const { tailordb = fallbackDb } = globalThis;

export { tailor, tailordb };
