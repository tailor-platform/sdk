import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "micro-challenge",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  resolver: { "micro-resolver": { files: ["./resolvers/*.ts"] } },
  executor: { files: ["./executors/*.ts"] },
});
