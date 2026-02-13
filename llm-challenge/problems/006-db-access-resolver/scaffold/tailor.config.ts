import { defineConfig, defineGenerators } from "@tailor-platform/sdk";

export const generators = defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: "./generated/tailordb.ts" },
]);

export default defineConfig({
  name: "challenge-006",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  resolver: {
    "my-resolver": { files: ["./resolvers/*.ts"] },
  },
});
