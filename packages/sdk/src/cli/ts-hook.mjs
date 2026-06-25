import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Node.js module hook: TypeScript resolver + type stripper via amaro.
// Registered programmatically so the CLI can import user .ts files without
// requiring --experimental-strip-types at process startup.
import { transformSync } from "amaro";

const TS_EXTENSIONS = [".ts", ".mts"];
const JS_TO_TS = new Map([
  [".js", ".ts"],
  [".mjs", ".mts"],
]);

// --- tsconfig paths resolution ---

const tsconfigPathsCache = new Map();

function collectPathsInto(out, configFilePath, content, visited) {
  if (visited.has(configFilePath)) return;
  visited.add(configFilePath);

  const baseDir = dirname(configFilePath);

  const extendsField = content.extends;
  if (typeof extendsField === "string") {
    const base = resolvePath(baseDir, extendsField);
    const extendsPath = base.endsWith(".json") ? base : base + ".json";
    try {
      const sub = JSON.parse(readFileSync(extendsPath, "utf-8"));
      collectPathsInto(out, extendsPath, sub, visited);
    } catch (e) {
      if (e?.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
    }
  }

  const opts = content.compilerOptions ?? {};
  const rawPaths = opts.paths;
  const baseUrl = opts.baseUrl;
  if (rawPaths && baseUrl) {
    const absBase = resolvePath(baseDir, baseUrl);
    for (const [alias, targets] of Object.entries(rawPaths)) {
      out[alias] = targets.map((t) => {
        const isWildcard = t.endsWith("/*");
        const resolved = resolvePath(absBase, isWildcard ? t.slice(0, -2) : t);
        return pathToFileURL(resolved).href + (isWildcard ? "/*" : "");
      });
    }
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

async function tryResolveWithExtensions(base, context, nextResolve) {
  if (!TS_EXTENSIONS.some((ext) => base.endsWith(ext))) {
    for (const ext of TS_EXTENSIONS) {
      for (const suffix of ["", "/index"]) {
        try {
          return await nextResolve(base + suffix + ext, context);
        } catch (e) {
          if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
        }
      }
    }
  }
  try {
    return await nextResolve(base, context);
  } catch (e) {
    const code = e?.code;
    if (code !== "ERR_MODULE_NOT_FOUND" && code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw e;
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

// --- module hooks ---

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err.code !== "ERR_MODULE_NOT_FOUND" && err.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw err;

    if (
      err.code === "ERR_UNSUPPORTED_DIR_IMPORT" &&
      (specifier.startsWith(".") || specifier.startsWith("/"))
    ) {
      for (const ext of TS_EXTENSIONS) {
        try {
          return await nextResolve(specifier + "/index" + ext, context);
        } catch (e) {
          if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
        }
      }
      throw err;
    }

    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      // Non-relative: try tsconfig path aliases
      if (context.parentURL?.startsWith("file://")) {
        const parentParsed = new URL(context.parentURL);
        parentParsed.search = "";
        parentParsed.hash = "";
        const parentDir = dirname(fileURLToPath(parentParsed));
        const tsconfigPaths = loadTsconfigPaths(parentDir);
        const candidates = matchTsconfigPaths(specifier, tsconfigPaths);
        if (candidates) {
          for (const candidate of candidates) {
            const result = await tryResolveWithExtensions(candidate, context, nextResolve);
            if (result) return result;
          }
        }
      }
      throw err;
    }

    const lastSegment = specifier.split("/").pop() ?? "";
    if (!lastSegment.includes(".")) {
      for (const ext of TS_EXTENSIONS) {
        try {
          return await nextResolve(specifier + ext, context);
        } catch (e) {
          if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
        }
      }
    }

    for (const [jsExt, tsExt] of JS_TO_TS) {
      if (specifier.endsWith(jsExt)) {
        try {
          return await nextResolve(specifier.slice(0, -jsExt.length) + tsExt, context);
        } catch (e) {
          if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
        }
      }
    }

    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:")) {
    const parsedUrl = new URL(url);
    if (TS_EXTENSIONS.some((ext) => parsedUrl.pathname.endsWith(ext))) {
      parsedUrl.search = "";
      parsedUrl.hash = "";
      const filePath = fileURLToPath(parsedUrl);
      const source = await readFile(filePath, "utf-8");
      const { code } = transformSync(source, { mode: "transform", filename: filePath });
      return { format: "module", shortCircuit: true, source: `${code}\n//# sourceURL=${url}` };
    }
  }
  return nextLoad(url, context);
}

// Sync hooks for module.registerHooks() (Node >= 22.15.0).
export function resolveSync(specifier, context, nextResolve) {
  try {
    return nextResolve(specifier, context);
  } catch (err) {
    if (err.code !== "ERR_MODULE_NOT_FOUND" && err.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw err;

    if (
      err.code === "ERR_UNSUPPORTED_DIR_IMPORT" &&
      (specifier.startsWith(".") || specifier.startsWith("/"))
    ) {
      for (const ext of TS_EXTENSIONS) {
        try {
          return nextResolve(specifier + "/index" + ext, context);
        } catch (e) {
          if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
        }
      }
      throw err;
    }

    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      // Non-relative: try tsconfig path aliases
      if (context.parentURL?.startsWith("file://")) {
        const parentParsed = new URL(context.parentURL);
        parentParsed.search = "";
        parentParsed.hash = "";
        const parentDir = dirname(fileURLToPath(parentParsed));
        const tsconfigPaths = loadTsconfigPaths(parentDir);
        const candidates = matchTsconfigPaths(specifier, tsconfigPaths);
        if (candidates) {
          for (const candidate of candidates) {
            const result = tryResolveWithExtensionsSync(candidate, context, nextResolve);
            if (result) return result;
          }
        }
      }
      throw err;
    }

    const lastSegment = specifier.split("/").pop() ?? "";
    if (!lastSegment.includes(".")) {
      for (const ext of TS_EXTENSIONS) {
        try {
          return nextResolve(specifier + ext, context);
        } catch (e) {
          if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
        }
      }
    }

    for (const [jsExt, tsExt] of JS_TO_TS) {
      if (specifier.endsWith(jsExt)) {
        try {
          return nextResolve(specifier.slice(0, -jsExt.length) + tsExt, context);
        } catch (e) {
          if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
        }
      }
    }

    throw err;
  }
}

export function loadSync(url, context, nextLoad) {
  if (url.startsWith("file:")) {
    const parsedUrl = new URL(url);
    if (TS_EXTENSIONS.some((ext) => parsedUrl.pathname.endsWith(ext))) {
      parsedUrl.search = "";
      parsedUrl.hash = "";
      const filePath = fileURLToPath(parsedUrl);
      const source = readFileSync(filePath, "utf-8");
      const { code } = transformSync(source, { mode: "transform", filename: filePath });
      return { format: "module", shortCircuit: true, source: `${code}\n//# sourceURL=${url}` };
    }
  }
  return nextLoad(url, context);
}
