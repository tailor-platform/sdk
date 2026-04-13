import Sonda from "sonda/rolldown";
import { defineConfig } from "tsdown";
import { loadYamlText } from "./scripts/yaml-text-plugin.mjs";
import type { Plugin } from "rolldown";

function yamlText(): Plugin {
  return {
    name: "yaml-text",
    load(id) {
      const result = loadYamlText(id);
      return result ? { code: result } : undefined;
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
  // `@tailor-platform/sdk` is self-referential (this package). The CLI
  // dynamically imports it at runtime to share the already-loaded module
  // with the user's code, so tell rolldown to leave it as an external.
  external: ["@tailor-platform/sdk"],
  outExtensions: () => ({
    js: ".mjs",
    dts: ".d.mts",
  }),
  banner: {
    dts: '/// <reference types="@tailor-platform/function-types" />',
  },
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
