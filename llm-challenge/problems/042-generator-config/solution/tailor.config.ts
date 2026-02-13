import { defineConfig, defineGenerators } from "@tailor-platform/sdk";

export const generators = defineGenerators(
  ["@tailor-platform/kysely-type", { distPath: "./generated/db.ts" }],
  ["@tailor-platform/enum-constants", { distPath: "./generated/enums.ts" }],
);

export default defineConfig({
  name: "challenge-042",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});
