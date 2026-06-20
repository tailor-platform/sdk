import "@tailor-platform/sdk/runtime/globals";

const { tailor: localTailor } = config;

const client = new tailor.idp.Client(localTailor);
