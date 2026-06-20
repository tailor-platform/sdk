import "@tailor-platform/sdk/runtime/globals";

const client = globalThis["tailor"].idp.Client;
const query = globalThis["tailordb"].QueryResult;

export { client, query };
