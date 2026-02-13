import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-018",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  executor: { files: ["./executors/*.ts"] },
});
