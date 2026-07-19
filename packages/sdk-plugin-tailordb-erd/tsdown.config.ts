import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/plugin.ts"],
  dts: true,
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
  onSuccess: (config) => {
    const target = path.resolve(config.outDir, "viewer-assets");
    rmSync(target, { recursive: true, force: true });
    cpSync(path.resolve("src/viewer-assets"), target, { recursive: true });
  },
});
