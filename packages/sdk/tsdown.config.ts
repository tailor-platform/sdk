import Sonda from "sonda/rolldown";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/configure/index.ts",
    "src/cli/index.ts",
    "src/cli/api.ts",
    "src/utils/test/index.ts",
  ],
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  dts: {
    banner: (chunk) => {
      const deps = chunk.fileName.split("/").length;
      if (chunk.fileName.endsWith(".d.mts")) {
        return `/// <reference path="./${"../".repeat(deps - 1)}plugin-generated.d.ts" />\n`;
      }
      return "";
    },
  },
  outDir: "dist",
  tsconfig: "./tsconfig.json",
  minify: false,
  outputOptions: {
    inlineDynamicImports: true,
  },
  outExtensions: () => ({
    js: ".mjs",
    dts: ".d.mts",
  }),
  sourcemap: true,
  plugins: [
    Sonda({
      open: false,
      format: "json",
      filename: "bundle-analysis.json",
      deep: true,
    }),
  ],
});
