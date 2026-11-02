import { cpSync } from "node:fs";
import path from "node:path";
import Sonda from "sonda/rolldown";
import { defineConfig } from "tsdown";
import { entry } from "./scripts/build-entries.mjs";

function copyToOutDir(outDir: string, source: string, dest: string): void {
  cpSync(path.resolve(source), path.join(outDir, dest));
}

const jsPlugins = [
  Sonda({
    open: false,
    format: "json",
    filename: "bundle-analysis.json",
    deep: true,
  }),
];

const externalDeps = ["vite", "vitest", /^@tailor-platform\/sdk$/];

const sharedOptions = {
  entry,
  format: "esm",
  target: "node22",
  platform: "node",
  outDir: "dist",
  tsconfig: "./tsconfig.json",
  minify: false,
  outExtensions: () => ({
    js: ".mjs",
    dts: ".d.mts",
  }),
} as const;

export default defineConfig([
  {
    ...sharedOptions,
    name: "js",
    clean: true,
    dts: false,
    sourcemap: true,
    minify: { mangle: { keepNames: true } },
    // peer dependencies: prevent bundling, resolve at runtime.
    // `@tailor-platform/sdk` (self-name) is kept external so subpath entries can reference
    // types like `ConnectionName`/`MachineUserName` from the main entry instead of inlining
    // them, letting a single `declare module "@tailor-platform/sdk"` augmentation narrow
    // every entry point.
    deps: { neverBundle: externalDeps },
    plugins: jsPlugins,
    onSuccess: (config) => {
      copyToOutDir(config.outDir, "src/cli/ts-hook.mjs", "cli/ts-hook.mjs");
      copyToOutDir(config.outDir, "src/cli/ts-hook.d.mts", "cli/ts-hook.d.mts");
    },
  },
  {
    ...sharedOptions,
    name: "dts",
    dts: {
      emitDtsOnly: true,
      tsc: { eager: true },
    },
    unbundle: true,
    root: "src",
    deps: { neverBundle: externalDeps },
  },
]);
