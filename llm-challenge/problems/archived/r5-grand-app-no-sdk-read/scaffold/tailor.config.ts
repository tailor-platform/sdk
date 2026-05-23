// TODO: Replace this scaffold with the full project config per problem.md.
// You must default-export the project config built from the SDK's
// defineConfig (or equivalent) and also export a named `plugins`
// constant that registers the Kysely-type plugin so the generator
// emits `./generated/tailordb.ts`.
import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "r2-grand-app",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
});
