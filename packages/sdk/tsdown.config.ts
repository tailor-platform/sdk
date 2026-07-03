import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import Sonda from "sonda/rolldown";
import { defineConfig, type TsdownPluginOption } from "tsdown";
import { entry } from "./scripts/build-entries.mjs";
import { loadYamlText } from "./scripts/yaml-text-plugin.mjs";

function copyErdViewerAssets(outDir: string): void {
  const source = path.resolve("src/cli/commands/tailordb/erd/viewer-assets");
  const target = path.resolve(outDir, "cli/erd-viewer-assets");
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
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
    // types like `ConnectionName`/`MachineUserName` from the main entry instead of inlining
    // them, letting a single `declare module "@tailor-platform/sdk"` augmentation narrow
    // every entry point.
    deps: { neverBundle: externalDeps },
    plugins: jsPlugins,
    onSuccess: (config) => {
      copyErdViewerAssets(config.outDir);
      cpSync(path.resolve("src/cli/ts-hook.mjs"), path.join(config.outDir, "cli/ts-hook.mjs"));
      cpSync(path.resolve("src/cli/ts-hook.d.mts"), path.join(config.outDir, "cli/ts-hook.d.mts"));
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
    deps: { neverBundle: externalDeps },
  },
]);
