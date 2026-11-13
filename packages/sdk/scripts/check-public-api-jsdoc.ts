// Verify every public API export has JSDoc.
//
// "Public API" is derived from package.json#exports — each `types` entry
// points at the .d.mts file under dist/, and the matching .ts source under
// src/ is the entry point this check walks. An entry whose `types` is a
// content-mapped `.tailor` file is walked through its `import` file instead. We replicate ESLint's
// require-public-api-jsdoc rule logic standalone so it does not depend on the
// linter at all.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API } from "typescript/sync";
import { findUndocumentedSymbols } from "./lib/find-undocumented-symbols.js";

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, "..");

interface PackageExports {
  [key: string]:
    | string
    | null
    | { types?: string; import?: string; default?: string }
    | PackageExports;
}

const pkg = JSON.parse(readFileSync(resolve(sdkRoot, "package.json"), "utf8")) as {
  exports: PackageExports;
};

function entryPoints(): string[] {
  const points: string[] = [];
  for (const [key, value] of Object.entries(pkg.exports)) {
    if (
      key.includes("*") ||
      typeof value !== "object" ||
      value === null ||
      !("types" in value) ||
      typeof value.types !== "string"
    ) {
      continue;
    }
    const types = value.types;
    const built =
      types.endsWith(".tailor") && typeof value.import === "string" ? value.import : types;
    const contentMapped = built !== types;
    const builtPattern = contentMapped ? /^\.\/dist\/.+\.mjs$/ : /^\.\/dist\/.+\.d\.mts$/;
    if (!builtPattern.test(built)) {
      throw new Error(
        `package.json exports[${JSON.stringify(key)}] does not match expected ${contentMapped ? "./dist/*.mjs" : "./dist/*.d.mts"} pattern: ${built}`,
      );
    }
    const src = built.replace(/^\.\/dist\//, "src/").replace(/\.d\.mts$|\.mjs$/, ".ts");
    const abs = resolve(sdkRoot, src);
    if (!existsSync(abs)) {
      throw new Error(
        `Derived source entry point for exports[${JSON.stringify(key)}] does not exist: ${abs} (from types: ${types})`,
      );
    }
    points.push(abs);
  }
  return points;
}

function loadCompilerOptions() {
  const api = new API({ cwd: sdkRoot });
  try {
    const parsed = api.readConfigFile(resolve(sdkRoot, "tsconfig.json"));
    if (parsed.error) {
      console.error(parsed.error.text);
      process.exit(1);
    }
    const config = api.parseJsonConfigFileContent(parsed.config, { configDirectory: sdkRoot });
    if (config.errors.length > 0) {
      for (const err of config.errors) {
        console.error(err.text);
      }
      process.exit(1);
    }
    return config.options;
  } finally {
    api.close();
  }
}

const failures = findUndocumentedSymbols(entryPoints(), loadCompilerOptions(), sdkRoot);

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
