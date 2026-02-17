import { defineConfig, defineGenerators } from "@tailor-platform/sdk";

export const generators = defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: "./generated/tailordb.ts" },
]);

export default defineConfig({
  name: "challenge-004",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  resolver: {
    "my-resolver": { files: ["./resolvers/**/resolver.ts", "./resolvers/*.ts"] },
  },
  workflow: {
    files: ["./workflows/*.ts"],
  },
});
