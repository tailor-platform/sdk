import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "micro-challenge",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  workflow: { files: ["./workflows/**/*.ts"] },
});

// Register kyselyTypePlugin so `pnpm tailor-sdk generate` writes
// ./generated/tailordb.ts. See problem.md for the full requirements.
