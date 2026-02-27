import { defineConfig, defineGenerators } from "@tailor-platform/sdk";

export default defineConfig({
  name: "challenge-002",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  resolver: {
    "my-resolver": {
      files: ["./resolvers/**/resolver.ts", "./resolvers/*.ts"],
    },
  },
});

export const generators = defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: "./generated/tailordb.ts" },
]);
