import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/configure/index.ts", "src/cli/index.ts", "src/cli/api.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  dts: {
    banner: (chunk) => {
      // Add triple-slash reference to configure/index.d.mts
      if (chunk.fileName === "configure/index.d.mts") {
        return '/// <reference path="../plugin-generated.d.ts" />\n';
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
});
