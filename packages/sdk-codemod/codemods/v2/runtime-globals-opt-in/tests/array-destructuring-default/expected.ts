import "@tailor-platform/sdk/runtime/globals";

const [client = new tailor.idp.Client()] = opts;

export { client };
