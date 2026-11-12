import { defineConfig } from "./my-config";

export default defineConfig({
  name: "shop",
  idp: [{ name: "shared-idp", external: true }],
});
