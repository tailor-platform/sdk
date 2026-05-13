import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export default defineConfig({
  name: "micro-challenge",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  workflow: { files: ["./workflows/**/*.ts"] },
});

export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }));
