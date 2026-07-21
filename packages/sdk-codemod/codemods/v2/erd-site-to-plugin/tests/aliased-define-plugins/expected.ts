import { defineConfig, definePlugins as makePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { tailordbErdPlugin } from "@tailor-platform/sdk-plugin-tailordb-erd";

export default defineConfig({
  name: "my-app",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});

export const plugins = makePlugins(
  kyselyTypePlugin({ distPath: "./generated/db.ts" }),
  tailordbErdPlugin({ sites: { tailordb: "my-erd-site" } }),
);
