import { createResolver } from "@tailor-platform/sdk";

export default createResolver({
  async handler() {
    const client = new tailor.idp.Client();
    return client;
  },
});
