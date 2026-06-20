import "@tailor-platform/sdk/runtime/globals";

const { ["tailor"]: runtimeTailor } = globalThis;
const { [`tailordb`]: runtimeDb } = globalThis;
const { ["TailorErrors" as const]: TailorErrorsClass } = globalThis;

export { runtimeDb, runtimeTailor, TailorErrorsClass };
