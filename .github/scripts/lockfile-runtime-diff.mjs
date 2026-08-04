#!/usr/bin/env node
// Diffs pnpm-lock.yaml's per-importer `dependencies` blocks (never
// `devDependencies`) between a before/after snapshot, to tell whether an
// automated lockfile change touched any published package's runtime
// dependencies. Used to decide whether the `skip-changeset` label applies:
// devDependencies-only bumps and pnpm-workspace.yaml policy pruning don't
// affect consumers and don't need a changeset.

import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { after: "pnpm-lock.yaml" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--before") args.before = argv[++i];
    else if (argv[i] === "--after") args.after = argv[++i];
  }
  if (!args.before) throw new Error("--before <path> is required");
  return args;
}

function parseImporters(text) {
  const lines = text.split("\n");
  const importersIdx = lines.findIndex((l) => /^importers:\s*$/.test(l));
  if (importersIdx === -1) return {};

  const importers = {};
  let currentImporter = null;
  let currentSection = null;
  let sectionLines = [];

  const flush = () => {
    if (currentImporter && currentSection === "dependencies") {
      importers[currentImporter] = sectionLines.join("\n");
    }
    sectionLines = [];
  };

  for (let i = importersIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.match(/^ */)[0].length;
    if (indent === 0) break; // back to top-level key, importers block ended

    if (indent === 2) {
      flush();
      currentImporter = line
        .trim()
        .replace(/:$/, "")
        .replace(/^["']|["']$/g, "");
      currentSection = null;
      continue;
    }
    if (indent === 4) {
      flush();
      currentSection = line.trim().replace(/:$/, "");
      continue;
    }
    if (currentSection === "dependencies") sectionLines.push(line);
  }
  flush();

  return importers;
}

function readPackageMeta(importerPath) {
  const pkgPath = importerPath === "." ? "package.json" : join(importerPath, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return { name: pkg.name, private: pkg.private === true };
  } catch {
    return null;
  }
}

// Packages in the same changeset "fixed" group always release together, so a
// change to one is reported under the group's first (primary) package name —
// otherwise a changeset naming e.g. create-sdk alone would fail
// `changeset version` with a "packages in a fixed group must release
// together" error.
function loadFixedGroupNormalizer() {
  const map = new Map();
  try {
    const config = JSON.parse(readFileSync(".changeset/config.json", "utf8"));
    for (const group of config.fixed ?? []) {
      for (const name of group) map.set(name, group[0]);
    }
  } catch {
    // no config.json or no "fixed" groups — normalization is a no-op
  }
  return (name) => map.get(name) ?? name;
}

function main() {
  const { before, after } = parseArgs(process.argv.slice(2));

  const beforeImporters = parseImporters(readFileSync(before, "utf8"));
  const afterImporters = parseImporters(readFileSync(after, "utf8"));

  const paths = new Set([...Object.keys(beforeImporters), ...Object.keys(afterImporters)]);
  const normalize = loadFixedGroupNormalizer();
  const changedNames = new Set();

  for (const importerPath of paths) {
    const beforeDeps = beforeImporters[importerPath] ?? "";
    const afterDeps = afterImporters[importerPath] ?? "";
    if (beforeDeps === afterDeps) continue;

    const meta = readPackageMeta(importerPath);
    if (!meta || meta.private || !meta.name) continue;
    changedNames.add(normalize(meta.name));
  }

  const sortedNames = [...changedNames].sort();
  const hasRuntimeChanges = sortedNames.length > 0;
  console.log(
    hasRuntimeChanges
      ? `Runtime dependency changes detected in: ${sortedNames.join(", ")}`
      : "No runtime dependency changes (devDependencies-only and/or policy-list pruning).",
  );

  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `has-runtime-changes=${hasRuntimeChanges}\n`);
    appendFileSync(
      outputFile,
      `changed-names<<LOCKFILE_DIFF_EOF\n${sortedNames.join("\n")}\nLOCKFILE_DIFF_EOF\n`,
    );
  }
}

main();
