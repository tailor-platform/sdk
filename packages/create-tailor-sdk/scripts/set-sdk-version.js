#!/usr/bin/env node

import { resolve } from "node:path";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";

const version = process.argv[2];

if (!version) {
  console.error("Usage: set-sdk-version <version>");
  process.exit(1);
}

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
