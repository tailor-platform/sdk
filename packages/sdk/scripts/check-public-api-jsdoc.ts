#!/usr/bin/env -S pnpm exec tsx
// Verify every public API export has JSDoc.
//
// "Public API" is derived from package.json#exports — each `types` entry
// points at the .d.mts file under dist/, and the matching .ts source under
// src/ is the entry point this check walks. We replicate ESLint's
// require-public-api-jsdoc rule logic standalone so it does not depend on the
// linter at all.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { findUndocumentedSymbols } from "../eslint-rules/require-public-api-jsdoc.js";

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, "..");

interface PackageExports {
  [key: string]: string | { types?: string; import?: string; default?: string } | PackageExports;
}

const pkg = JSON.parse(readFileSync(resolve(sdkRoot, "package.json"), "utf8")) as {
  exports: PackageExports;
};

function entryPoints(): string[] {
  const points: string[] = [];
  for (const value of Object.values(pkg.exports)) {
    if (typeof value === "object" && value && "types" in value && typeof value.types === "string") {
      const src = value.types.replace(/^\.\/dist\//, "src/").replace(/\.d\.mts$/, ".ts");
      points.push(resolve(sdkRoot, src));
    }
  }
  return points;
}

const tsconfigPath = resolve(sdkRoot, "tsconfig.json");
const parsed = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
if (parsed.error) {
  console.error(ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"));
  process.exit(1);
}
const config = ts.parseJsonConfigFileContent(parsed.config, ts.sys, sdkRoot);
const failures = findUndocumentedSymbols(entryPoints(), config.options, sdkRoot);

if (failures.length === 0) {
  process.exit(0);
}

console.error(
  `Found ${failures.length} undocumented public API symbol(s). ` +
    `Add JSDoc to each exported value-level symbol below:`,
);
for (const f of failures) {
  console.error(`  ${f.location}: ${f.kind} '${f.name}'`);
}
process.exit(1);
