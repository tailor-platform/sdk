#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolve a package's version or URL from an environment variable (can be a
// version string or a pkg-pr-new URL), falling back to the package.json in
// this repository.
function resolveVersion({ envVar, packageDir, label }) {
  const fromEnv = process.env[envVar];
  if (fromEnv) {
    console.log(`Using ${label} version from environment: ${fromEnv}`);
    return fromEnv;
  }
  const packageJsonPath = resolve(import.meta.dirname, "..", "..", packageDir, "package.json");
  const { version } = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  console.log(`Using ${label} version from package.json: ${version}`);
  return version;
}

const packageVersions = {
  "@tailor-platform/sdk": resolveVersion({
    envVar: "TAILOR_TEMPLATE_SDK_VERSION",
    packageDir: "sdk",
    label: "SDK",
  }),
  "@tailor-platform/sdk-plugin-seed": resolveVersion({
    envVar: "TAILOR_TEMPLATE_SEED_PLUGIN_VERSION",
    packageDir: "sdk-plugin-seed",
    label: "seed plugin",
  }),
};

// Update versions in each template's package.json
const templatesDir = resolve(import.meta.dirname, "..", "templates");
const templates = readdirSync(templatesDir, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name);
for (const template of templates) {
  const packageJsonPath = resolve(templatesDir, template, "package.json");
  if (!existsSync(packageJsonPath)) continue;

  const content = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const updated = [];
  for (const [packageName, packageVersion] of Object.entries(packageVersions)) {
    if (content.dependencies?.[packageName]) {
      content.dependencies[packageName] = packageVersion;
      updated.push(`${packageName}@${packageVersion}`);
    }
    if (content.devDependencies?.[packageName]) {
      content.devDependencies[packageName] = packageVersion;
      updated.push(`${packageName}@${packageVersion}`);
    }
  }

  writeFileSync(packageJsonPath, JSON.stringify(content, null, 2) + "\n");
  console.log(`Updated ${template}/package.json to use ${updated.join(", ")}`);
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
