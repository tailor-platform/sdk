#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

// Get SDK version or URL from environment variable or package.json
const sdkVersionOrUrl = process.env.TAILOR_SDK_VERSION;
const eslintPluginVersionOrUrl = process.env.TAILOR_SDK_ESLINT_PLUGIN_VERSION;

let sdkVersion;
if (sdkVersionOrUrl) {
  // If TAILOR_SDK_VERSION is set, use it (can be version string or pkg-pr-new URL)
  sdkVersion = sdkVersionOrUrl;
  console.log(`Using SDK version from environment: ${sdkVersion}`);
} else {
  // Otherwise, read version from tailor-sdk's package.json
  const tailorSdkPackageJsonPath = resolve(import.meta.dirname, "..", "..", "sdk", "package.json");
  const tailorSdkPackageJson = JSON.parse(readFileSync(tailorSdkPackageJsonPath, "utf-8"));
  sdkVersion = tailorSdkPackageJson.version;
  console.log(`Using SDK version from package.json: ${sdkVersion}`);
}

let eslintPluginVersion;
if (eslintPluginVersionOrUrl) {
  eslintPluginVersion = eslintPluginVersionOrUrl;
  console.log(`Using ESLint plugin version from environment: ${eslintPluginVersion}`);
} else {
  const eslintPluginPackageJsonPath = resolve(
    import.meta.dirname,
    "..",
    "..",
    "eslint-plugin-sdk",
    "package.json",
  );
  const eslintPluginPackageJson = JSON.parse(readFileSync(eslintPluginPackageJsonPath, "utf-8"));
  eslintPluginVersion = eslintPluginPackageJson.version;
  console.log(`Using ESLint plugin version from package.json: ${eslintPluginVersion}`);
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
    content.dependencies["@tailor-platform/sdk"] = sdkVersion;
  }
  if (content.devDependencies?.["@tailor-platform/sdk"]) {
    content.devDependencies["@tailor-platform/sdk"] = sdkVersion;
  }
  if (content.devDependencies?.["@tailor-platform/eslint-plugin-sdk"]) {
    content.devDependencies["@tailor-platform/eslint-plugin-sdk"] = eslintPluginVersion;
  }

  writeFileSync(packageJsonPath, JSON.stringify(content, null, 2) + "\n");
  console.log(`Updated package dependencies in ${template}/package.json`);
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
