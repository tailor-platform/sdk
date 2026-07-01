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

export default defineConfig({
  entry,
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  dts: false,
  outDir: "dist",
  tsconfig: "./tsconfig.json",
  minify: false,
  outExtensions: () => ({
    js: ".mjs",
    dts: ".d.mts",
  }),
  // peer dependencies: prevent bundling, resolve at runtime
  deps: { neverBundle: ["vite", "vitest"] },
  sourcemap: true,
  plugins: jsPlugins,
  onSuccess: (config) => {
    copyErdViewerAssets(config.outDir);
  },
});
