import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import { tailordbErdPlugin } from "@tailor-platform/sdk-plugin-tailordb-erd/plugin";

export default defineConfig({
  name: "my-app",
  db: {
    "my-db": { files: ["./tailordb/*.ts"] },
  },
});

export const plugins = definePlugins(
  tailordbErdPlugin({ sites: { "my-db": "my-erd-site" } }),
);
