import "@tailor-platform/sdk/runtime/globals";

const fn = function (tailor: unknown) {
  return tailor;
};

const client = new tailor.idp.Client();

export { client, fn };
