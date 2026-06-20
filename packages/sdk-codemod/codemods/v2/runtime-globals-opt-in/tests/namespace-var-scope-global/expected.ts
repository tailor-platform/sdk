import "@tailor-platform/sdk/runtime/globals";

namespace Local {
  var tailor = { value: 1 };
  tailor.value;
}

const client = new tailor.idp.Client();

export { client };
