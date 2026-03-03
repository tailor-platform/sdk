import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "project-mgmt",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
});
