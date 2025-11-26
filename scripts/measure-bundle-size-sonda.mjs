#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { init, parse } from "es-module-lexer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sdkDir = path.join(__dirname, "../packages/sdk");
const sondaOutput = path.join(sdkDir, ".sonda/bundle-analysis.json");

function getChunkSize(report, distPath) {
  const normalized = distPath.startsWith("dist/")
    ? distPath
    : `dist/${distPath}`;
  const entry = report.resources.find(
    (r) => r.kind === "asset" && r.name === normalized,
  );
  return entry?.uncompressed ?? 0;
}

function getImports(file) {
  const code = fs.readFileSync(file, "utf8");
  const [imports] = parse(code);
  return imports.map((i) => code.slice(i.s, i.e));
}

function collectDependencies(entryFile, visited = new Set()) {
  if (visited.has(entryFile)) return [];
  visited.add(entryFile);

  const deps = [];
  for (const imp of getImports(entryFile)) {
    // Skip non-relative imports (node_modules)
    if (!imp.startsWith(".")) continue;

    const target = path.resolve(path.dirname(entryFile), imp);
    if (fs.existsSync(target)) {
      deps.push(target);
      deps.push(...collectDependencies(target, visited));
    }
  }
  return deps;
}

async function main() {
  if (!fs.existsSync(sondaOutput)) {
    console.error(`Error: Sonda output not found at ${sondaOutput}`);
    console.error("Please run 'pnpm build' first");
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(sondaOutput, "utf8"));

  // Initialize es-module-lexer
  await init;

  const entryPath = path.join(sdkDir, "dist/configure/index.mjs");
  const configureSize = getChunkSize(report, "dist/configure/index.mjs");

  const deps = collectDependencies(entryPath);
  const depsSize = deps.reduce((sum, dep) => {
    const relativePath = path.relative(sdkDir, dep);
    return sum + getChunkSize(report, relativePath);
  }, 0);

  const totalSize = configureSize + depsSize;

  const configureSizeKB = parseFloat((configureSize / 1024).toFixed(2));
  const depsSizeKB = parseFloat((depsSize / 1024).toFixed(2));
  const totalSizeKB = parseFloat((totalSize / 1024).toFixed(2));

  const output = {
    key: "bundle-size",
    name: "SDK Configure Bundle Size",
    metrics: [
      {
        key: "configure-index-size",
        name: "Configure index.mjs size",
        value: configureSizeKB,
        unit: " KB",
      },
      {
        key: "dependency-chunks-size",
        name: "Dependency chunks size",
        value: depsSizeKB,
        unit: " KB",
      },
      {
        key: "total-bundle-size",
        name: "Total bundle size",
        value: totalSizeKB,
        unit: " KB",
      },
    ],
  };

  const outputPath = path.join(sdkDir, "bundle-size.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");

  console.log(
    `✓ Bundle size report written to ${path.relative(process.cwd(), outputPath)}`,
  );
  console.log(
    `  Total: ${totalSizeKB} KB (configure: ${configureSizeKB} KB + deps: ${depsSizeKB} KB)`,
  );
}

main();
