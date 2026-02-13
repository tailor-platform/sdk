import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "benchmark-001",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});
