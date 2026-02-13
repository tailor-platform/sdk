import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-037",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  executor: {
    files: ["./executors/*.ts"],
  },
  workflow: {
    files: ["./workflows/*.ts"],
  },
});
