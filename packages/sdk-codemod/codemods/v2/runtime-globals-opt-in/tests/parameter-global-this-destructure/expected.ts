import "@tailor-platform/sdk/runtime/globals";

function build({ tailor } = globalThis, { tailordb: db } = (globalThis as typeof globalThis)) {
  return { db, tailor };
}

export { build };
