import { defineConfig } from "tsdown";
import { loadYamlText } from "./scripts/yaml-text-plugin.mjs";

function yamlText() {
  return {
    name: "yaml-text",
    load(id: string) {
      const result = loadYamlText(id);
      return result ? { code: result } : undefined;
    },
  };
}

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  dts: true,
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  outDir: "dist",
  tsconfig: "./tsconfig.json",
  plugins: [yamlText()],
  deps: { neverBundle: [/^@tailor-platform\/sdk$/, /^@tailor-platform\/sdk\//] },
  outExtensions: () => ({
    js: ".js",
  }),
});
