import { defineConfig, defineIdp } from "@tailor-platform/sdk";

const idp = defineIdp("backoffice-idp", { clients: ["backoffice-client"] });

export default defineConfig({
  name: "backoffice",
  idp: idp,
});
