import { defineConfig, definePlugins, defineStaticWebSite } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

const erdSite = defineStaticWebSite("my-erd-site", {
  description: "ERD site for TailorDB",
});

export default defineConfig({
  name: "my-app",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
      erdSite: erdSite.name,
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
);
