import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-040",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  executor: {
    files: ["./executors/*.ts"],
  },
});
