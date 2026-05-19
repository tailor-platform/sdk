import * as path from "pathe";

const PACKAGE_NAME = "@tailor-platform/function-types";

// `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`,
// and `bundleDependencies` (the standard alias `bundledDependencies` is also
// covered) — every place npm/pnpm/yarn recognize as a dependency mapping.
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundleDependencies",
  "bundledDependencies",
] as const;

function removeFromDependencyMap(parsed: Record<string, unknown>, field: string): boolean {
  const map = parsed[field];
  if (typeof map !== "object" || map == null || Array.isArray(map)) return false;
  const record = map as Record<string, unknown>;
  if (!(PACKAGE_NAME in record)) return false;
  delete record[PACKAGE_NAME];
  // Drop the dependency section entirely when removing this key empties it,
  // so re-running the codemod (or pnpm install) does not leave behind a noisy
  // `"dependencies": {}` block.
  if (Object.keys(record).length === 0) {
    delete parsed[field];
  }
  return true;
}

function removeFromCompilerTypes(parsed: Record<string, unknown>): boolean {
  const compilerOptions = parsed.compilerOptions;
  if (typeof compilerOptions !== "object" || compilerOptions == null) return false;
  const opts = compilerOptions as Record<string, unknown>;
  const types = opts.types;
  if (!Array.isArray(types)) return false;
  const filtered = types.filter((t) => t !== PACKAGE_NAME);
  if (filtered.length === types.length) return false;
  if (filtered.length === 0) {
    delete opts.types;
  } else {
    opts.types = filtered;
  }
  return true;
}

function tryParseJson(source: string): Record<string, unknown> | null {
  try {
    return JSON.parse(source) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stripJsonComments(source: string): string {
  // String-aware best-effort comment stripper for tsconfig.json. JSON.parse
  // rejects `//` and `/* */` comments but `tsc` accepts them. Only invoked as
  // a fallback after vanilla `JSON.parse` fails, so plain JSON paths skip
  // this entirely.
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '"') {
      const start = i;
      i++;
      while (i < source.length) {
        const c = source[i]!;
        if (c === "\\" && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (c === '"') {
          i++;
          break;
        }
        i++;
      }
      out += source.slice(start, i);
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Remove the `@tailor-platform/function-types` reference from both
 * `package.json` dependency maps and `tsconfig.json`
 * `compilerOptions.types`. The package's declarations are now vendored
 * inside `@tailor-platform/sdk` and activated automatically when importing
 * the SDK (or explicitly via `import "@tailor-platform/sdk/runtime/globals"`),
 * so the external dependency is no longer needed.
 *
 * The codemod dispatches purely on JSON content shape, so it works regardless
 * of the fixture file name during tests. Runner-side file selection should be
 * narrowed via the registry's `filePatterns` (`package.json` and
 * `tsconfig*.json`).
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to ignore non-JSON inputs)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!source.includes(PACKAGE_NAME)) return null;
  if (path.extname(filePath).toLowerCase() !== ".json") return null;

  const parsed = tryParseJson(source) ?? tryParseJson(stripJsonComments(source));
  if (!parsed) return null;

  let modified = false;
  for (const field of DEPENDENCY_FIELDS) {
    if (removeFromDependencyMap(parsed, field)) modified = true;
  }
  if (removeFromCompilerTypes(parsed)) modified = true;

  if (!modified) return null;
  const trailing = source.endsWith("\n") ? "\n" : "";
  return JSON.stringify(parsed, null, 2) + trailing;
}
