import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "saas-platform",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
});
