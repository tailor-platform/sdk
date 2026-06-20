const runtime = globalThis;

const client = runtime.tailor.idp.Client;
const database = runtime["tailordb"];

export { client, database };
