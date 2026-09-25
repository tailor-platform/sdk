import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";

export default defineConfig({
  name: "seed-json-error-test",
  db: { "main-db": { files: ["./seed-target.ts"] } },
});

export const plugins = definePlugins(seedPlugin({ distPath: "./seed" }));
