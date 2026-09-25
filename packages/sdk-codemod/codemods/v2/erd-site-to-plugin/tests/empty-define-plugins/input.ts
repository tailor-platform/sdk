import { defineConfig, definePlugins } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  db: {
    tailordb: { files: ["./tailordb/*.ts"], erdSite: "my-erd-site" },
  },
});

export const plugins = definePlugins(
);
