import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/plugin.ts", "src/eslint.ts", "src/pglite-connection.ts"],
  dts: true,
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  outDir: "dist",
  tsconfig: "./tsconfig.json",

  outExtensions: () => ({ js: ".js" }),
});
