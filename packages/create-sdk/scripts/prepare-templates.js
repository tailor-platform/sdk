#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

// Get SDK version or URL from environment variable or package.json
const sdkVersionOrUrl = process.env.TAILOR_SDK_VERSION;

let version;
if (sdkVersionOrUrl) {
  // If TAILOR_SDK_VERSION is set, use it (can be version string or pkg-pr-new URL)
  version = sdkVersionOrUrl;
  console.log(`Using SDK version from environment: ${version}`);
} else {
  // Otherwise, read version from tailor-sdk's package.json
  const tailorSdkPackageJsonPath = resolve(import.meta.dirname, "..", "..", "sdk", "package.json");
  const tailorSdkPackageJson = JSON.parse(readFileSync(tailorSdkPackageJsonPath, "utf-8"));
  version = tailorSdkPackageJson.version;
  console.log(`Using SDK version from package.json: ${version}`);
}

// Parse the catalog section from pnpm-workspace.yaml to resolve "catalog:" specs.
// Uses simple line parsing since the catalog is a flat key-value map.
function parseCatalog(yamlPath) {
  const lines = readFileSync(yamlPath, "utf-8").split("\n");
  const result = {};
  let inCatalog = false;
  for (const line of lines) {
    if (/^catalog:\s*$/.test(line)) {
      inCatalog = true;
      continue;
    }
    if (inCatalog) {
      const match = line.match(/^ {2}(\S+):\s+(.+)$/);
      if (match) {
        result[match[1]] = match[2];
      } else if (/^\S/.test(line)) {
        break; // next top-level key
      }
    }
  }
  return result;
}

const workspaceYamlPath = resolve(import.meta.dirname, "..", "..", "..", "pnpm-workspace.yaml");
const catalog = parseCatalog(workspaceYamlPath);

function resolveCatalogSpecs(deps) {
  if (!deps) return;
  for (const [name, spec] of Object.entries(deps)) {
    if (spec === "catalog:" && catalog[name]) {
      deps[name] = catalog[name];
    }
  }
}

// Update version in each template's package.json
const templatesDir = resolve(import.meta.dirname, "..", "templates");
const templates = readdirSync(templatesDir, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name);
for (const template of templates) {
  const packageJsonPath = resolve(templatesDir, template, "package.json");
  if (!existsSync(packageJsonPath)) continue;

  const content = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  if (content.dependencies?.["@tailor-platform/sdk"]) {
    content.dependencies["@tailor-platform/sdk"] = version;
  }
  if (content.devDependencies?.["@tailor-platform/sdk"]) {
    content.devDependencies["@tailor-platform/sdk"] = version;
  }

  // Resolve "catalog:" specs so scaffolded projects work outside this monorepo
  resolveCatalogSpecs(content.dependencies);
  resolveCatalogSpecs(content.devDependencies);

  writeFileSync(packageJsonPath, JSON.stringify(content, null, 2) + "\n");
  console.log(`Updated ${template}/package.json to use SDK: ${version}`);
}

// Copy .gitignore to __dot__gitignore
// refs: https://github.com/npm/cli/issues/5756
for (const template of templates) {
  const gitignorePath = resolve(templatesDir, template, ".gitignore");
  const dotGitignorePath = resolve(templatesDir, template, "__dot__gitignore");
  if (existsSync(gitignorePath)) {
    copyFileSync(gitignorePath, dotGitignorePath);
    console.log(`Copied ${template}/.gitignore to __dot__gitignore`);
  }
}

console.log("Done!");
