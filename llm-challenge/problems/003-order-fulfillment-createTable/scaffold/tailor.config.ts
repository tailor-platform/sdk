import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "order-fulfillment",
  db: { tailordb: { files: ["./tailordb/*.ts"] } },
});
