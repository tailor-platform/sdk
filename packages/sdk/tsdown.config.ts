import * as fs from "node:fs";
import Sonda from "sonda/rolldown";
import { defineConfig } from "tsdown";
import type { Plugin } from "rolldown";

function yamlText(): Plugin {
  return {
    name: "yaml-text",
    load(id) {
      if (id.endsWith(".yml") || id.endsWith(".yaml")) {
        const content = fs.readFileSync(id, "utf-8");
        return { code: `export default ${JSON.stringify(content)};` };
      }
    },
  };
}

export default defineConfig({
  entry: [
    "src/configure/index.ts",
    "src/cli/index.ts",
    "src/cli/lib.ts",
    "src/cli/skills.ts",
    "src/utils/test/index.ts",
    "src/kysely/index.ts",
    "src/plugin/index.ts",
    "src/plugin/builtin/kysely-type/index.ts",
    "src/plugin/builtin/enum-constants/index.ts",
    "src/plugin/builtin/file-utils/index.ts",
    "src/plugin/builtin/seed/index.ts",
    "src/seed/index.ts",
  ],
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  dts: true,
  outDir: "dist",
  tsconfig: "./tsconfig.json",
  minify: false,
  outExtensions: () => ({
    js: ".mjs",
    dts: ".d.mts",
  }),
  sourcemap: true,
  plugins: [
    yamlText(),
    Sonda({
      open: false,
      format: "json",
      filename: "bundle-analysis.json",
      deep: true,
    }),
  ],
});
