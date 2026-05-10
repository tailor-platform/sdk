import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "product-catalog",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
});
