import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import Sonda from "sonda/rolldown";
import { defineConfig } from "tsdown";

function addDtsBanner(dir: string, baseDir: string = dir): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      addDtsBanner(fullPath, baseDir);
    } else if (entry.endsWith(".d.mts")) {
      const relativePath = fullPath.replace(baseDir + "/", "");
      const depth = relativePath.split("/").length;
      const banner = `/// <reference path="./${"../".repeat(depth - 1)}user-defined.d.ts" />\n`;
      const content = readFileSync(fullPath, "utf-8");
      if (!content.startsWith("/// <reference")) {
        writeFileSync(fullPath, banner + content);
      }
    }
  }
}

export default defineConfig({
  entry: [
    "src/configure/index.ts",
    "src/cli/index.ts",
    "src/cli/lib.ts",
    "src/utils/test/index.ts",
  ],
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  dts: true,
  outDir: "dist",
  hooks: {
    "build:done": () => {
      addDtsBanner("dist");
    },
  },
  tsconfig: "./tsconfig.json",
  minify: false,
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
