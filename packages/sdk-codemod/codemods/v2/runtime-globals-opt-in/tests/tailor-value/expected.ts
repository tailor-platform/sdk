import { createResolver } from "@tailor-platform/sdk";
import "@tailor-platform/sdk/runtime/globals";

export default createResolver({
  async handler() {
    const client = new tailor.idp.Client();
    return client;
  },
});
