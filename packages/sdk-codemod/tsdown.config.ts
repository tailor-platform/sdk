import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "node18",
    platform: "node",
    clean: true,
    outDir: "dist",
    tsconfig: "./tsconfig.json",
    outExtensions: () => ({
      js: ".js",
    }),
  },
  {
    entry: {
      "v2/define-generators-to-plugins/scripts/transform":
        "codemods/v2/define-generators-to-plugins/scripts/transform.ts",
    },
    format: ["esm"],
    target: "node18",
    platform: "node",
    outDir: "dist/codemods",
    tsconfig: "./tsconfig.json",
    outExtensions: () => ({
      js: ".js",
    }),
  },
]);
