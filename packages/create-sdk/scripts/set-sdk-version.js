#!/usr/bin/env node

import { resolve } from "node:path";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";

// Get SDK version or URL from environment variable or package.json
const sdkVersionOrUrl = process.env.TAILOR_SDK_VERSION;

let version;
if (sdkVersionOrUrl) {
  // If TAILOR_SDK_VERSION is set, use it (can be version string or pkg-pr-new URL)
  version = sdkVersionOrUrl;
  console.log(`Using SDK version from environment: ${version}`);
} else {
  // Otherwise, read version from tailor-sdk's package.json
  const tailorSdkPackageJsonPath = resolve(
    import.meta.dirname,
    "..",
    "..",
    "sdk",
    "package.json",
  );
  const tailorSdkPackageJson = JSON.parse(
    readFileSync(tailorSdkPackageJsonPath, "utf-8"),
  );
  version = tailorSdkPackageJson.version;
  console.log(`Using SDK version from package.json: ${version}`);
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

  writeFileSync(packageJsonPath, JSON.stringify(content, null, 2) + "\n");
  console.log(`Updated ${template}/package.json to use SDK: ${version}`);
}

console.log("Done!");
