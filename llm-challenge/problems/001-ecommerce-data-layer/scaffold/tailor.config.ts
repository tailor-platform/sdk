import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-001",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
});
