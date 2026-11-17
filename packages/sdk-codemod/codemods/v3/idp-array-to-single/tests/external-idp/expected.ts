import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "shop",
  idp: { name: "shared-idp", external: true },
});
