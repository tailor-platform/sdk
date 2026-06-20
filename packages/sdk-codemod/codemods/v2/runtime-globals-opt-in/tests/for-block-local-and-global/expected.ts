import "@tailor-platform/sdk/runtime/globals";

for (const item of items) {
  {
    const tailor = item;
    tailor.run();
  }

  const client = new tailor.idp.Client();
  use(client);
}
