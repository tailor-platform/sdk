import { defineConfig, definePlugins, defineStaticWebSite } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { tailordbErdPlugin } from "@tailor-platform/sdk-plugin-tailordb-erd";

const erdSite = defineStaticWebSite("my-erd-site", {
  description: "ERD site for TailorDB",
});

export default defineConfig({
  name: "my-app",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
      migration: {
        directory: "./migrations",
      },
    },
    analyticsdb: {
      files: ["./analyticsdb/*.ts"],
    },
  },
  staticWebsites: [erdSite],
});

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }),
  tailordbErdPlugin({ sites: { tailordb: erdSite.name } }),
);
