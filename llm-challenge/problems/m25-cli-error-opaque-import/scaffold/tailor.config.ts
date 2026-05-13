import { defineConfig, definePlugins } from "@tailor-platform/sdk";
// BUG: this package name looks right but does not exist. The plugin actually
// lives at `@tailor-platform/sdk/plugin/kysely-type` (singular, SDK sub-path).
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
