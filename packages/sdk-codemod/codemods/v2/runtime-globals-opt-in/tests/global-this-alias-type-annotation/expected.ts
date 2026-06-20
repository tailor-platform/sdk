import "@tailor-platform/sdk/runtime/globals";

const runtime: typeof globalThis = globalThis;

const client = runtime.tailor.idp.Client;

export { client };
