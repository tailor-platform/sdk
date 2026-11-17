import * as sdk from "@tailor-platform/sdk";

export default sdk.defineConfig({
  name: "shop",
  idp: [{ name: "shared-idp", external: true }],
});
