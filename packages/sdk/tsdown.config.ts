import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import Sonda from "sonda/rolldown";
import { defineConfig } from "tsdown";
import { entry } from "./scripts/build-entries.mjs";
import type { OutputOptions, PreRenderedChunk } from "rolldown";

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

const GRAPHQL_DIR = "node_modules/graphql/";
const WORKSPACE_DIR = /^.*?packages\//;

function stableChunkName(name: string): string {
  const graphqlAt = name.indexOf(GRAPHQL_DIR);
  if (graphqlAt !== -1) return `vendor/graphql/${name.slice(graphqlAt + GRAPHQL_DIR.length)}`;
  return name.replace(WORKSPACE_DIR, "");
}

function renameChunk(template: OutputOptions["entryFileNames"]) {
  return (chunk: PreRenderedChunk): string => {
    const resolved = typeof template === "function" ? template(chunk) : (template ?? "[name].js");
    return resolved.replace("[name]", stableChunkName(chunk.name.replace(/\.d$/, "")));
  };
}

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
      eager: true,
    },
    unbundle: true,
    root: "src",
    deps: { neverBundle: externalDeps, dts: { alwaysBundle: [/^graphql(\/|$)/] } },
    outputOptions: (options) => ({
      ...options,
      entryFileNames: renameChunk(options.entryFileNames),
      chunkFileNames: renameChunk(options.chunkFileNames),
    }),
    onSuccess: (config) => {
      const vendorDir = path.join(config.outDir, "vendor/graphql");
      mkdirSync(vendorDir, { recursive: true });
      copyToOutDir(config.outDir, "node_modules/graphql/LICENSE", "vendor/graphql/LICENSE");
      for (const file of readdirSync(vendorDir, { recursive: true, encoding: "utf8" })) {
        if (!file.endsWith(".d.mts")) continue;
        const target = path.join(vendorDir, file);
        writeFileSync(
          target,
          readFileSync(target, "utf8").replace(
            /^\/\/#region .*node_modules\/graphql\//gm,
            "//#region graphql/",
          ),
        );
      }
    },
  },
]);
