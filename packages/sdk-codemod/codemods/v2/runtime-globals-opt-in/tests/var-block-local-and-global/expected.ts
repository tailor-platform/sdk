import "@tailor-platform/sdk/runtime/globals";

function run() {
  {
    var tailor = localClient;
  }

  return tailor;
}

const client = new tailor.idp.Client();

export { client, run };
