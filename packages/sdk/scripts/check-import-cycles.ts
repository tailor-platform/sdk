#!/usr/bin/env -S node --experimental-strip-types
// Verify the src/ module graph is acyclic — including type-only edges.
//
// oxlint's import/no-cycle (ignoreTypes: false) already rejects cycles formed
// by import declarations, but it cannot see two kinds of edges:
//   1. files excluded from linting (src/types/*.generated.ts), and
//   2. inline `import("...")` type references, which zinfer emits into
//      generated files.
// This check builds the full graph over src/**/*.ts from raw source text
// (static imports, re-exports, dynamic imports, and inline import() type
// references) and fails if any strongly connected component contains more
// than one module.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractImportSpecifiers } from "./lib/scan-imports.js";

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, "..");
const srcRoot = join(sdkRoot, "src");

const EXCLUDED_DIR_NAMES = new Set(["__test_fixtures__", "__test_bundler__", "node_modules"]);

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!EXCLUDED_DIR_NAMES.has(entry) && !entry.startsWith(".")) {
        files.push(...listSourceFiles(full));
      }
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

function resolveSpecifier(file: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("#/")) {
    base = join(srcRoot, specifier.slice("#/".length));
  } else if (specifier.startsWith(".")) {
    base = normalize(resolve(dirname(file), specifier));
  } else {
    return null; // external package
  }
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts")]) {
    if (candidate.endsWith(".ts") && existsSync(candidate)) {
      return candidate;
    }
  }
  return null; // e.g. example paths inside help-text strings
}

const files = listSourceFiles(srcRoot);
const graph = new Map<string, string[]>();
for (const file of files) {
  // The scanner ignores specifiers inside comments and string/template
  // literals (JSDoc @example imports, codegen templates), while still seeing
  // inline `import("...")` type refs in real code.
  const source = readFileSync(file, "utf8");
  const edges = new Set<string>();
  for (const specifier of extractImportSpecifiers(source)) {
    const target = resolveSpecifier(file, specifier);
    if (target !== null && target !== file) {
      edges.add(target);
    }
  }
  graph.set(file, [...edges]);
}

// Tarjan's strongly connected components.
let index = 0;
const indices = new Map<string, number>();
const lowlinks = new Map<string, number>();
const onStack = new Set<string>();
const stack: string[] = [];
const cycles: string[][] = [];

function strongConnect(v: string): void {
  indices.set(v, index);
  lowlinks.set(v, index);
  index += 1;
  stack.push(v);
  onStack.add(v);
  for (const w of graph.get(v) ?? []) {
    if (!indices.has(w)) {
      strongConnect(w);
      lowlinks.set(v, Math.min(lowlinks.get(v) as number, lowlinks.get(w) as number));
    } else if (onStack.has(w)) {
      lowlinks.set(v, Math.min(lowlinks.get(v) as number, indices.get(w) as number));
    }
  }
  if (lowlinks.get(v) === indices.get(v)) {
    const component: string[] = [];
    let w: string;
    do {
      w = stack.pop() as string;
      onStack.delete(w);
      component.push(w);
    } while (w !== v);
    if (component.length > 1) {
      cycles.push(component);
    }
  }
}

for (const file of graph.keys()) {
  if (!indices.has(file)) {
    strongConnect(file);
  }
}

if (cycles.length === 0) {
  console.log(
    `check-import-cycles: ${graph.size} modules, no import cycles (type-level included).`,
  );
  process.exit(0);
}

console.error("check-import-cycles: circular imports detected (type-only edges count too):\n");
for (const component of cycles) {
  console.error(`  Cycle of ${component.length} modules:`);
  for (const file of component.toSorted()) {
    console.error(`    ${relative(sdkRoot, file)}`);
  }
}
process.exit(1);
