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

const sharedConfig = {
  target: "node18" as const,
  platform: "node" as const,
  dts: true,
  outDir: "dist",
  tsconfig: "./tsconfig.json",
  minify: false,
  sourcemap: true,
};

export default defineConfig([
  // Main ESM build
  {
    ...sharedConfig,
    entry: [
      "src/configure/index.ts",
      "src/cli/index.ts",
      "src/cli/lib.ts",
      "src/cli/skills.ts",
      "src/utils/test/index.ts",
      "src/kysely/index.ts",
      "src/graphql/index.ts",
      "src/plugin/index.ts",
    ],
    format: ["esm"],
    clean: true,
    hooks: {
      "build:done": () => {
        addDtsBanner("dist");
      },
    },
    outExtensions: () => ({
      js: ".mjs",
      dts: ".d.mts",
    }),
    plugins: [
      Sonda({
        open: false,
        format: "json",
        filename: "bundle-analysis.json",
        deep: true,
      }),
    ],
  },
  // TS Language Service Plugin (CJS for TypeScript server require())
  {
    ...sharedConfig,
    entry: ["src/ts-plugin/index.ts"],
    format: ["cjs"],
    outDir: "dist/ts-plugin",
    outExtensions: () => ({
      js: ".cjs",
      dts: ".d.cts",
    }),
  },
]);
