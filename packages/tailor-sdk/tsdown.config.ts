import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cli/index.ts", "src/cli/exec.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  dts: true,
  outDir: "dist",
  tsconfig: "./tsconfig.json",
  minify: false,
  noExternal: [/^@tailor-platform\/tailor-proto/],
});
