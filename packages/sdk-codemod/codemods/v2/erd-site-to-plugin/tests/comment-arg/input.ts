import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export default defineConfig({
  name: "my-app",
  db: {
    tailordb: { files: ["./tailordb/*.ts"], erdSite: "my-erd-site" },
  },
});

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./generated/db.ts" }) // kysely types
);
