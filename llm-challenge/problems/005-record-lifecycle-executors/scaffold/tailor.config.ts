import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-005",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  resolver: {
    "my-resolver": { files: ["./resolvers/**/resolver.ts"] },
  },
  executor: { files: ["./executors/*.ts"] },
});
