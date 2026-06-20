import "@tailor-platform/sdk/runtime/globals";

const runtime = globalThis;
const globals = runtime;

const client = globals.tailor.idp.Client;

export { client };
