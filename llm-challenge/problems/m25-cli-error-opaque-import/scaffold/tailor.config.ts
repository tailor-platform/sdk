import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/kysely-types";

export default defineConfig({
  name: "micro-challenge",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
});

export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }));
