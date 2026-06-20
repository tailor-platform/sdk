import "@tailor-platform/sdk/runtime/globals";

const runtime = globalThis;

const client = runtime.tailor.idp.Client;
const database = runtime["tailordb"];

export { client, database };
