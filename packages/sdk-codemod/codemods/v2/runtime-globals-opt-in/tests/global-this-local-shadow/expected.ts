import "@tailor-platform/sdk/runtime/globals";

function run(tailor: unknown) {
  return globalThis.tailor.idp.Client;
}

export { run };
