import "@tailor-platform/sdk/runtime/globals";

const client = globalThis["tailor" as const];
const db = globalThis?.["tailordb" as const];
const errors = globalThis[`TailorErrors`];

export { client, db, errors };
