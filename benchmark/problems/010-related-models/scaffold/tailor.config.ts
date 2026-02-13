import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "benchmark-010",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});
