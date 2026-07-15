import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import Sonda from "sonda/rolldown";
import { defineConfig, type TsdownPluginOption } from "tsdown";
import { entry } from "./scripts/build-entries.mjs";
import { loadYamlText } from "./scripts/yaml-text-plugin.mjs";

const runtimeGlobalsBanner = '/// <reference types="@tailor-platform/sdk/runtime/globals" />';
const runtimeGlobalsBannerPattern =
  /^\/\/\/ <reference types="@tailor-platform\/sdk\/runtime\/globals" \/>\r?\n/;

function copyErdViewerAssets(outDir: string): void {
  const source = path.resolve("src/cli/commands/tailordb/erd/viewer-assets");
  const target = path.resolve(outDir, "cli/erd-viewer-assets");
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
}

function stripBannerExceptConfigureEntry(outDir: string): void {
  const root = path.resolve(outDir);
  const keep = path.join(root, "configure", "index.d.mts");
  const walk = (current: string): void => {
    for (const dirent of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        walk(full);
      } else if (dirent.isFile() && dirent.name.endsWith(".d.mts") && full !== keep) {
        const content = readFileSync(full, "utf-8");
        const cleaned = content.replace(runtimeGlobalsBannerPattern, "");
        if (cleaned !== content) writeFileSync(full, cleaned, "utf-8");
      }
    }
  };
  walk(root);
}

function yamlText() {
  return {
    name: "yaml-text",
    load(id: string) {
      const result = loadYamlText(id);
      return result ? { code: result } : undefined;
    },
  };
}

// Annotate as TsdownPluginOption[] to work around a tsgo TS2321 caused by
// rolldown's Plugin type appearing under two paths in node_modules (root
// rc.17 from tsdown's pin, packages/sdk rc.18 from our direct dep). tsc
// handles this fine; tsgo's recursive Plugin comparison gets stuck.
const jsPlugins: TsdownPluginOption[] = [
  yamlText(),
  Sonda({
    open: false,
    format: "json",
    filename: "bundle-analysis.json",
    deep: true,
  }) as TsdownPluginOption,
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
    // peer dependencies: prevent bundling, resolve at runtime.
    // `@tailor-platform/sdk` (self-name) is kept external so subpath entries can reference
    // types like `ConnectionName` from the main entry instead of inlining them, letting a
    // single `declare module "@tailor-platform/sdk"` augmentation narrow every entry point.
    deps: { neverBundle: externalDeps },
    plugins: jsPlugins,
    onSuccess: (config) => {
      copyErdViewerAssets(config.outDir);
    },
  },
  {
    ...sharedOptions,
    name: "dts",
    dts: {
      emitDtsOnly: true,
    },
    unbundle: true,
    root: "src",
    banner: {
      dts: runtimeGlobalsBanner,
    },
    deps: { neverBundle: externalDeps },
    onSuccess: (config) => {
      stripBannerExceptConfigureEntry(config.outDir);
    },
  },
]);
