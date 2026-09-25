#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import madge from "madge";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sdkDir = path.join(__dirname, "../packages/sdk");
const sondaOutput = path.join(sdkDir, ".sonda/bundle-analysis.json");

function getChunkSize(report, distPath) {
  const normalized = distPath.startsWith("dist/") ? distPath : `dist/${distPath}`;

  const entry = report.resources.find(
    (r) => r.kind === "asset" && path.normalize(r.name) === path.normalize(normalized),
  );
  return entry?.uncompressed ?? 0;
}

async function collectDependencies(entryFile) {
  const result = await madge(entryFile, {
    fileExtensions: ["mjs", "js"],
    excludeRegExp: [/node_modules/],
    baseDir: sdkDir,
  });

  const dependencyObj = result.obj();
  const visited = new Set();
  const deps = [];

  function traverse(file) {
    if (visited.has(file)) return;
    visited.add(file);

    const fileDeps = dependencyObj[file] || [];
    for (const dep of fileDeps) {
      const absolutePath = path.resolve(sdkDir, dep);
      deps.push(absolutePath);
      traverse(dep);
    }
  }

  const relativeEntry = path.relative(sdkDir, entryFile);
  traverse(relativeEntry);

  return deps;
}

async function main() {
  if (!fs.existsSync(sondaOutput)) {
    console.error(`Error: Sonda output not found at ${sondaOutput}`);
    console.error("Please run 'pnpm build' first");
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(sondaOutput, "utf8"));

  const entryPath = path.join(sdkDir, "dist/configure/index.mjs");
  const configureSize = getChunkSize(report, "dist/configure/index.mjs");

  const deps = await collectDependencies(entryPath);
  const depsSize = deps.reduce((sum, dep) => {
    const relativePath = path.relative(sdkDir, dep);
    return sum + getChunkSize(report, relativePath);
  }, 0);

  const totalSize = configureSize + depsSize;

  const output = {
    key: "bundle-size",
    name: "SDK Configure Bundle Size",
    metrics: [
      {
        key: "configure-index-size",
        value: +(configureSize / 1024).toFixed(2),
        unit: "KB",
      },
      {
        key: "dependency-chunks-size",
        value: +(depsSize / 1024).toFixed(2),
        unit: "KB",
      },
      {
        key: "total-bundle-size",
        value: +(totalSize / 1024).toFixed(2),
        unit: "KB",
      },
    ],
  };

  const outputPath = path.join(sdkDir, "bundle-size.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
}

main();
