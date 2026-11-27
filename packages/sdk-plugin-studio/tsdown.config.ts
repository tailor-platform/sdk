import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  dts: { tsc: { eager: true } },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  outDir: "dist",
  tsconfig: "./tsconfig.json",
  deps: { neverBundle: [/^@tailor-platform\/sdk$/, /^@tailor-platform\/sdk\//] },
  outExtensions: () => ({
    js: ".js",
  }),
});
