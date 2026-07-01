import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import Sonda from "sonda/rolldown";
import { defineConfig, type TsdownPluginOption, type UserConfig } from "tsdown";
import { loadYamlText } from "./scripts/yaml-text-plugin.mjs";

// `banner.dts` injects the triple-slash into every emitted d.mts. Keep it only
// on `configure/index.d.mts` (the `@tailor-platform/sdk` main entry) so that
// the legacy ambient globals stay active for that import path through v2.0.
// Strip it from every other `.d.mts` so subpath imports
// (`@tailor-platform/sdk/runtime`, `/vitest`, /plugin`, etc.) stay self-contained.
function stripBannerExceptConfigureEntry(outDir: string): void {
  const pattern = /^\/\/\/ <reference types="@tailor-platform\/sdk\/runtime\/globals" \/>\r?\n/;
  const root = path.resolve(outDir);
  const keep = path.join(root, "configure", "index.d.mts");
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".d.mts") && full !== keep) {
        const content = readFileSync(full, "utf-8");
        const cleaned = content.replace(pattern, "");
        if (cleaned !== content) writeFileSync(full, cleaned, "utf-8");
      }
    }
  };
  walk(root);
}

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

// Exported for knip.ts: knip's tsdown plugin can't statically read this list
// once the config is a two-element array, so knip imports it directly.
export const entry = [
  "src/configure/index.ts",
  "src/cli/index.ts",
  "src/cli/lib.ts",
  "src/cli/skills.ts",
  "src/utils/test/index.ts",
  "src/kysely/index.ts",
  "src/plugin/index.ts",
  "src/plugin/builtin/kysely-type/index.ts",
  "src/plugin/builtin/enum-constants/index.ts",
  "src/plugin/builtin/file-utils/index.ts",
  "src/plugin/builtin/seed/index.ts",
  "src/seed/index.ts",
  "src/vitest/index.ts",
  "src/vitest/environment.ts",
  "src/vitest/setup.ts",
  "src/runtime/index.ts",
  "src/runtime/globals.ts",
  "src/runtime/iconv.ts",
  "src/runtime/secretmanager.ts",
  "src/runtime/authconnection.ts",
  "src/runtime/idp.ts",
  "src/runtime/workflow.ts",
  "src/runtime/context.ts",
  "src/runtime/file.ts",
];

const shared = {
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  tsconfig: "./tsconfig.json",
  minify: false,
  outExtensions: () => ({
    js: ".mjs",
    dts: ".d.mts",
  }),
  // peer dependencies: prevent bundling, resolve at runtime
  deps: { neverBundle: ["vite", "vitest"] },
} satisfies UserConfig;

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

const dtsPlugins: TsdownPluginOption[] = [yamlText()];

// Two configs share the same `dist`: JS stays bundled, while dts output uses
// `unbundle` to mirror the src tree with real identifier names. Only the JS
// config opts into `clean` so declaration files can be emitted alongside it.
export default defineConfig([
  {
    ...shared,
    entry,
    clean: true,
    dts: false,
    sourcemap: true,
    plugins: jsPlugins,
    onSuccess: (config) => {
      copyErdViewerAssets(config.outDir);
    },
  },
  {
    ...shared,
    entry,
    clean: false,
    dts: { emitDtsOnly: true },
    unbundle: true,
    // Remove in v2.0.
    banner: {
      dts: '/// <reference types="@tailor-platform/sdk/runtime/globals" />',
    },
    plugins: dtsPlugins,
    onSuccess: (config) => {
      stripBannerExceptConfigureEntry(config.outDir);
    },
  },
]);
