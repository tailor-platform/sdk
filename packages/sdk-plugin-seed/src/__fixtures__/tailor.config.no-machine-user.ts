import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";

export default defineConfig({ name: "seed-json-error-test" });

export const plugins = definePlugins(seedPlugin({ distPath: "./seed" }));
