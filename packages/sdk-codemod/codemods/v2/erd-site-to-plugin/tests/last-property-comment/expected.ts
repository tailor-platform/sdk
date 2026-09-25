import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { tailordbErdPlugin } from "@tailor-platform/sdk-plugin-tailordb-erd";

export default defineConfig({
  name: "my-app",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"]
    },
  },
});

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./generated/db.ts" }),
  tailordbErdPlugin({ sites: { tailordb: "my-erd-site" } }),
);
