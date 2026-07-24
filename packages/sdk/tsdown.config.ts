import { chmodSync, cpSync } from "node:fs";
import path from "node:path";
import Sonda from "sonda/rolldown";
import { defineConfig, type TsdownPluginOption } from "tsdown";
import { entry } from "./scripts/build-entries.mjs";
import { loadYamlText } from "./scripts/yaml-text-plugin.mjs";

function copyToOutDir(outDir: string, source: string, dest: string, executable: boolean): void {
  const target = path.join(outDir, dest);
  cpSync(path.resolve(source), target);
  if (executable) chmodSync(target, 0o755);
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
      copyToOutDir(config.outDir, "src/cli/ts-hook.mjs", "cli/ts-hook.mjs", false);
      copyToOutDir(config.outDir, "src/cli/ts-hook.d.mts", "cli/ts-hook.d.mts", false);
      copyToOutDir(config.outDir, "src/cli/index.mjs", "cli/index.mjs", true);
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
