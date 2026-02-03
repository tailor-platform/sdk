import { defineConfig, defineGenerators } from "@tailor-platform/sdk";

export default defineConfig({
  name: "hello-world",
  db: { "main-db": { files: [`./src/db/*.ts`] } },
  resolver: { "main-resolver": { files: [`./src/resolvers/**/*.ts`] } },
});

export const generators = defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: `./src/generated/kysely-tailordb.ts` },
]);
