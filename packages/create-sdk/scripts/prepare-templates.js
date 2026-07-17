#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

// Get SDK version or URL from environment variable or package.json
const sdkVersionOrUrl = process.env.TAILOR_TEMPLATE_SDK_VERSION;

let version;
if (sdkVersionOrUrl) {
  // If TAILOR_TEMPLATE_SDK_VERSION is set, use it (can be version string or pkg-pr-new URL)
  version = sdkVersionOrUrl;
  console.log(`Using SDK version from environment: ${version}`);
} else {
  // Otherwise, read version from tailor-sdk's package.json
  const tailorSdkPackageJsonPath = resolve(import.meta.dirname, "..", "..", "sdk", "package.json");
  const tailorSdkPackageJson = JSON.parse(readFileSync(tailorSdkPackageJsonPath, "utf-8"));
  version = tailorSdkPackageJson.version;
  console.log(`Using SDK version from package.json: ${version}`);
}

// Get seed plugin version or URL the same way (falls back to its package.json)
const seedPluginVersionOrUrl = process.env.TAILOR_TEMPLATE_SEED_PLUGIN_VERSION;

let seedPluginVersion;
if (seedPluginVersionOrUrl) {
  seedPluginVersion = seedPluginVersionOrUrl;
  console.log(`Using seed plugin version from environment: ${seedPluginVersion}`);
} else {
  const seedPluginPackageJsonPath = resolve(
    import.meta.dirname,
    "..",
    "..",
    "sdk-plugin-seed",
    "package.json",
  );
  const seedPluginPackageJson = JSON.parse(readFileSync(seedPluginPackageJsonPath, "utf-8"));
  seedPluginVersion = seedPluginPackageJson.version;
  console.log(`Using seed plugin version from package.json: ${seedPluginVersion}`);
}

const packageVersions = {
  "@tailor-platform/sdk": version,
  "@tailor-platform/sdk-plugin-seed": seedPluginVersion,
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
  for (const [packageName, packageVersion] of Object.entries(packageVersions)) {
    if (content.dependencies?.[packageName]) {
      content.dependencies[packageName] = packageVersion;
    }
    if (content.devDependencies?.[packageName]) {
      content.devDependencies[packageName] = packageVersion;
    }
  }

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
