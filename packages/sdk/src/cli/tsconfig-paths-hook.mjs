import { readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolve-only Node.js module hook: fixes tsconfig `paths` alias resolution
// for dynamically-imported user files (resolvers, executors, workflows,
// TailorDB types). tsx's own tsconfig-paths support is scoped to the
// tsconfig discovered relative to where tsx itself was registered, so an
// alias declared in a project-local tsconfig.json can fail to resolve (or
// resolve against the wrong project) when the imported file lives in a
// different directory. This hook re-derives the effective `paths` map from
// the importing file's own directory on every miss, so each dynamically
// loaded file resolves against its own project's tsconfig regardless of
// process cwd or which other tsconfig-bearing projects have already been
// loaded in the same process.
//
// TypeScript transformation itself is left to tsx's already-registered load
// hook; this only supplies the resolve fallback tsx's cwd-scoped resolver
// misses.

const TS_EXTENSIONS = [".ts", ".tsx", ".mts"];

const tsconfigPathsCache = new Map();

// Walks the `extends` chain and returns the nearest-defined `baseUrl` (which
// may come from a different config than the one defining `paths`), the
// nearest-defined `paths` object (TypeScript replaces, not merges, inherited
// `paths` once a config defines its own), and the directory of the config
// that defines that `paths` object (the TS 5.0+ fallback base when no
// `baseUrl` is defined anywhere in the chain).
function resolveEffectiveConfig(configFilePath, content, visited) {
  if (visited.has(configFilePath)) return {};
  visited.add(configFilePath);

  const baseDir = dirname(configFilePath);
  const opts = content.compilerOptions ?? {};
  const ownBaseUrl =
    typeof opts.baseUrl === "string" ? resolvePath(baseDir, opts.baseUrl) : undefined;
  const ownRawPaths =
    opts.paths && typeof opts.paths === "object" && !Array.isArray(opts.paths)
      ? opts.paths
      : undefined;

  let inherited = {};
  const extendsField = content.extends;
  if (typeof extendsField === "string") {
    const base = resolvePath(baseDir, extendsField);
    const extendsPath = base.endsWith(".json") ? base : base + ".json";
    try {
      const sub = JSON.parse(readFileSync(extendsPath, "utf-8"));
      inherited = resolveEffectiveConfig(extendsPath, sub, visited);
    } catch (e) {
      if (e?.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
    }
  }

  return {
    baseUrl: ownBaseUrl ?? inherited.baseUrl,
    rawPaths: ownRawPaths ?? inherited.rawPaths,
    pathsBaseDir: ownRawPaths ? baseDir : inherited.pathsBaseDir,
  };
}

function collectPathsInto(out, configFilePath, content, visited) {
  const { baseUrl, rawPaths, pathsBaseDir } = resolveEffectiveConfig(
    configFilePath,
    content,
    visited,
  );
  if (!rawPaths) return;

  const absBase = baseUrl ?? pathsBaseDir ?? dirname(configFilePath);
  for (const [alias, targets] of Object.entries(rawPaths)) {
    if (!Array.isArray(targets)) continue;
    const normalized = targets
      .filter((t) => typeof t === "string")
      .map((t) => {
        const isWildcard = t.endsWith("/*");
        const resolved = resolvePath(absBase, isWildcard ? t.slice(0, -2) : t);
        return pathToFileURL(resolved).href + (isWildcard ? "/*" : "");
      });
    if (normalized.length === 0) continue;
    out[alias] = normalized;
  }
}

function loadTsconfigPaths(startDir) {
  if (tsconfigPathsCache.has(startDir)) return tsconfigPathsCache.get(startDir);

  const paths = Object.create(null);
  let dir = startDir;
  let prev = "";
  while (dir !== prev) {
    try {
      const configFilePath = join(dir, "tsconfig.json");
      const content = JSON.parse(readFileSync(configFilePath, "utf-8"));
      collectPathsInto(paths, configFilePath, content, new Set());
      break;
    } catch (e) {
      if (e?.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
      if (e instanceof SyntaxError) break;
    }
    prev = dir;
    dir = dirname(dir);
  }

  tsconfigPathsCache.set(startDir, paths);
  return paths;
}

function matchTsconfigPaths(specifier, paths) {
  if (paths[specifier]?.length > 0) {
    return paths[specifier];
  }
  const wildcardEntries = Object.entries(paths)
    .filter(([alias]) => alias.endsWith("/*"))
    .toSorted((a, b) => b[0].length - a[0].length);
  for (const [alias, targets] of wildcardEntries) {
    const prefix = alias.slice(0, -2);
    if (specifier.startsWith(prefix + "/")) {
      const rest = specifier.slice(prefix.length + 1);
      return targets.map((t) => (t.endsWith("/*") ? t.slice(0, -2) + "/" + rest : t));
    }
  }
  return null;
}

function tryResolveWithExtensionsSync(base, context, nextResolve) {
  if (!TS_EXTENSIONS.some((ext) => base.endsWith(ext))) {
    for (const ext of TS_EXTENSIONS) {
      for (const suffix of ["", "/index"]) {
        try {
          return nextResolve(base + suffix + ext, context);
        } catch (e) {
          if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
        }
      }
    }
  }
  try {
    return nextResolve(base, context);
  } catch (e) {
    const code = e?.code;
    if (code !== "ERR_MODULE_NOT_FOUND" && code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw e;
  }
  return null;
}

// Sync hook for module.registerHooks(). Only handles the case default
// resolution (including tsx's own tsconfig-paths support) already failed on:
// a non-relative bare specifier that maps to a tsconfig `paths` alias
// declared by a tsconfig.json above the importing file's own directory.
// Relative imports and anything tsx/Node already resolves are left alone.
export function resolveSync(specifier, context, nextResolve) {
  try {
    return nextResolve(specifier, context);
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    if (specifier.startsWith(".") || specifier.startsWith("/")) throw err;
    if (!context.parentURL?.startsWith("file://")) throw err;

    const parentParsed = new URL(context.parentURL);
    parentParsed.search = "";
    parentParsed.hash = "";
    const parentDir = dirname(fileURLToPath(parentParsed));
    const candidates = matchTsconfigPaths(specifier, loadTsconfigPaths(parentDir));
    if (!candidates) throw err;

    for (const candidate of candidates) {
      const result = tryResolveWithExtensionsSync(candidate, context, nextResolve);
      if (result) return result;
    }
    throw err;
  }
}
