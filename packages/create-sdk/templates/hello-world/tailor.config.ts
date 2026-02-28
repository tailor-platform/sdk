import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export default defineConfig({
  name: "hello-world",
  db: { "main-db": { files: [`./src/db/*.ts`] } },
  resolver: { "main-resolver": { files: [`./src/resolvers/**/*.ts`] } },
});

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: `./src/generated/kysely-tailordb.ts` }),
);
