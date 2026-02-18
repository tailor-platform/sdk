import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-006",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  resolver: {
    "my-resolver": { files: ["./resolvers/**/resolver.ts"] },
  },
  executor: { files: ["./executors/*.ts"] },
  workflow: { files: ["./workflows/**/*.ts"] },
});
