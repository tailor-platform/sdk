import "@tailor-platform/sdk/runtime/globals";

const { tailor } = globalThis;
const { tailordb: db } = globalThis;
const { TailorErrors = Error } = globalThis;

export { db, tailor, TailorErrors };
