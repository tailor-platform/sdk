import { defineConfig, defineIdp } from "@tailor-platform/sdk";

export default defineConfig({
  name: "backoffice",
  idp: [
    defineIdp("backoffice-idp", { clients: ["backoffice-client"] }),
    defineIdp("customer-idp", { clients: ["customer-client"] }),
  ],
});
