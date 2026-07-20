import { defineConfig, definePlugins as makePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export default defineConfig({
  name: "my-app",
  db: {
    tailordb: { files: ["./tailordb/*.ts"], erdSite: "my-erd-site" },
  },
});

export const plugins = makePlugins(
  kyselyTypePlugin({ distPath: "./generated/db.ts" }),
);
