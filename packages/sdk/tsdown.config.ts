import Sonda from "sonda/rolldown";
import { defineConfig, type TsdownPluginOption } from "tsdown";
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

// Annotate as TsdownPluginOption[] to work around a tsgo TS2321 caused by
// rolldown's Plugin type appearing under two paths in node_modules (root
// rc.17 from tsdown's pin, packages/sdk rc.18 from our direct dep). tsc
// handles this fine; tsgo's recursive Plugin comparison gets stuck.
const plugins: TsdownPluginOption[] = [
  yamlText(),
  Sonda({
    open: false,
    format: "json",
    filename: "bundle-analysis.json",
    deep: true,
  }),
];

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
    "src/vitest/index.ts",
    "src/vitest/environment.ts",
    "src/vitest/setup.ts",
  ],
  format: ["esm"],
  target: "node22",
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
  banner: {
    dts: '/// <reference types="@tailor-platform/function-types" />',
  },
  external: ["vite", "vitest"], // peer dependencies: prevent bundling, resolve at runtime
  sourcemap: true,
  plugins,
});
