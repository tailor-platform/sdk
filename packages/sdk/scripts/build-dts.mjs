import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rolldown } from "rolldown";
import { dts } from "rolldown-plugin-dts";
import { entry } from "./build-entries.mjs";

const outDir = "dist";
const runtimeGlobalsBanner = '/// <reference types="@tailor-platform/sdk/runtime/globals" />';
const runtimeGlobalsBannerPattern =
  /^\/\/\/ <reference types="@tailor-platform\/sdk\/runtime\/globals" \/>\r?\n/;

function isBareSpecifier(id) {
  return (
    !path.isAbsolute(id) &&
    !path.win32.isAbsolute(id) &&
    !id.startsWith(".") &&
    !id.startsWith("#/")
  );
}

function isExternal(id, _importer, isResolved) {
  return !isResolved && isBareSpecifier(id) && !id.startsWith("@tailor-platform/tailor-proto");
}

function removeDtsArtifacts(dir) {
  if (!existsSync(dir)) return;
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      removeDtsArtifacts(full);
    } else if (dirent.isFile() && /\.d\.[cm]?ts(\.map)?$/.test(dirent.name)) {
      rmSync(full);
    }
  }
}

function stripBannerExceptConfigureEntry(dir) {
  const root = path.resolve(dir);
  const keep = path.join(root, "configure", "index.d.mts");
  const walk = (current) => {
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

removeDtsArtifacts(outDir);

const bundle = await rolldown({
  input: entry,
  cwd: process.cwd(),
  external: isExternal,
  tsconfig: "./tsconfig.json",
  plugins: [dts({ tsconfig: "./tsconfig.json", emitDtsOnly: true })],
  checks: { pluginTimings: false },
});

try {
  await bundle.write({
    dir: outDir,
    format: "es",
    preserveModules: true,
    preserveModulesRoot: "src",
    entryFileNames: "[name].mjs",
    chunkFileNames: "[name].mjs",
    postBanner: runtimeGlobalsBanner,
  });
} finally {
  await bundle.close();
}

stripBannerExceptConfigureEntry(outDir);
