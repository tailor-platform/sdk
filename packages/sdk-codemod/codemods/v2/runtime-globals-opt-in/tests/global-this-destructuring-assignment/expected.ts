import "@tailor-platform/sdk/runtime/globals";

let db;
let tailorClient;

({ tailordb: db } = globalThis);
({ tailor: tailorClient } = globalThis);

export { db, tailorClient };
