import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import { tailordbErdPlugin } from "@tailor-platform/sdk-plugin-tailordb-erd";

export default defineConfig({
  name: "my-app",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
});

export const plugins = definePlugins(
  tailordbErdPlugin({ sites: { tailordb: "my-erd-site" } }),
);
