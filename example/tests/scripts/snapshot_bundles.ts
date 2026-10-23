import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { deploy } from "@tailor-platform/sdk/cli";

const __filename = url.fileURLToPath(import.meta.url);

const configPaths = ["tailor.config.ts", "tests/tailor.config.plugins-compat.ts"];
const inlineSourcemapModes = ["true", "false"];

async function writeBundles(configPath: string, outDir: string): Promise<void> {
  // A fresh build directory keeps the bundle cache from serving bundles from an earlier build.
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-bundles-"));
  try {
    process.env.TAILOR_BUILD_OUTPUT_DIR = buildDir;
    const result = await deploy({ configPath, buildOnly: true });
    if (!result) {
      throw new Error(`deploy returned no bundles for ${configPath}`);
    }
    for (const [kind, scripts] of Object.entries<ReadonlyMap<string, string>>(
      result.bundledScripts,
    )) {
      const kindDir = path.join(outDir, kind);
      fs.mkdirSync(kindDir, { recursive: true });
      for (const [name, code] of scripts) {
        fs.writeFileSync(path.join(kindDir, `${encodeURIComponent(name)}.js`), code);
      }
    }
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
}

/**
 * Writes the bundled functions of each example config, with inline sourcemaps on and off,
 * under `<outDir>/<config>-inline-<true|false>/<kind>/`. Each build runs in its own process.
 * @param outDir - Directory to write the snapshot into; must not exist yet
 */
function snapshotBundles(outDir: string): void {
  if (fs.existsSync(outDir)) {
    throw new Error(`${outDir} already exists`);
  }
  for (const configPath of configPaths) {
    for (const inlineSourcemap of inlineSourcemapModes) {
      const buildOutDir = path.join(
        outDir,
        `${path.basename(configPath, ".ts")}-inline-${inlineSourcemap}`,
      );
      execFileSync(
        process.execPath,
        [...process.execArgv, __filename, buildOutDir, configPath, inlineSourcemap],
        { stdio: "inherit" },
      );
    }
  }
}

if (process.argv[1] === __filename) {
  const [outDir, configPath, inlineSourcemap] = process.argv.slice(2);
  if (!outDir) {
    console.error("Usage: pnpm snapshot:bundles <outDir>");
    process.exit(1);
  }
  process.env.TAILOR_PLATFORM_WORKSPACE_ID ??= "00000000-0000-4000-8000-000000000000";
  if (configPath) {
    process.env.TAILOR_INLINE_SOURCEMAP = inlineSourcemap;
    await writeBundles(configPath, path.resolve(outDir));
  } else {
    snapshotBundles(path.resolve(outDir));
  }
}
