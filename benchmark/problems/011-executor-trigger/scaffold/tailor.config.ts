import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "benchmark-011",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  executor: { files: ["./executors/*.ts"] },
});
