#!/usr/bin/env node

import { resolve } from "node:path";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";

// Read version from tailor-sdk's package.json
const tailorSdkPackageJsonPath = resolve(
  import.meta.dirname,
  "..",
  "..",
  "tailor-sdk",
  "package.json",
);
const tailorSdkPackageJson = JSON.parse(
  readFileSync(tailorSdkPackageJsonPath, "utf-8"),
);
const version = tailorSdkPackageJson.version;

// Update version in each template's package.json
const templatesDir = resolve(import.meta.dirname, "..", "templates");
const templates = readdirSync(templatesDir, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name);
for (const template of templates) {
  const packageJsonPath = resolve(templatesDir, template, "package.json");
  if (!existsSync(packageJsonPath)) continue;

  const content = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  if (content.dependencies?.["@tailor-platform/tailor-sdk"]) {
    content.dependencies["@tailor-platform/tailor-sdk"] = version;
  }
  if (content.devDependencies?.["@tailor-platform/tailor-sdk"]) {
    content.devDependencies["@tailor-platform/tailor-sdk"] = version;
  }

  writeFileSync(packageJsonPath, JSON.stringify(content, null, 2) + "\n");
  console.log(`Updated ${template}/package.json`);
}

console.log("Done!");
