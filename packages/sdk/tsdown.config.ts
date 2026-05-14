import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Sonda from "sonda/rolldown";
import { defineConfig, type TsdownPluginOption } from "tsdown";
import { loadYamlText } from "./scripts/yaml-text-plugin.mjs";

// `banner.dts` injects the triple-slash into every emitted d.mts, including
// `runtime/globals.d.mts` itself. Strip it from that one file to avoid a
// self-reference TS1006 when consumers typecheck with `skipLibCheck: false`.
function stripSelfReferenceFromGlobalsDts(outDir: string): void {
  const target = path.resolve(outDir, "runtime/globals.d.mts");
  const content = readFileSync(target, "utf-8");
  const cleaned = content.replace(
    /^\/\/\/ <reference types="@tailor-platform\/sdk\/runtime\/globals" \/>\n/,
    "",
  );
  if (cleaned !== content) {
    writeFileSync(target, cleaned, "utf-8");
  }
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
const plugins: TsdownPluginOption[] = [
  yamlText(),
  Sonda({
    open: false,
    format: "json",
    filename: "bundle-analysis.json",
    deep: true,
  }),
];

export default defineConfig({
  entry: [
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
  ],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  dts: true,
  outDir: "dist",
  tsconfig: "./tsconfig.json",
  minify: false,
  outExtensions: () => ({
    js: ".mjs",
    dts: ".d.mts",
  }),
  // Remove in v2.0.
  banner: {
    dts: '/// <reference types="@tailor-platform/sdk/runtime/globals" />',
  },
  external: ["vite", "vitest"], // peer dependencies: prevent bundling, resolve at runtime
  sourcemap: true,
  plugins,
  onSuccess: (config) => {
    stripSelfReferenceFromGlobalsDts(config.outDir);
  },
});
