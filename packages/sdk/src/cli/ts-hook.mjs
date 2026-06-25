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

function collectPathsInto(out, baseDir, content, visited) {
  const id = join(baseDir, "tsconfig.json");
  if (visited.has(id)) return;
  visited.add(id);

  const extendsField = content.extends;
  if (typeof extendsField === "string") {
    const base = resolvePath(baseDir, extendsField);
    const extendsPath = base.endsWith(".json") ? base : base + ".json";
    try {
      const sub = JSON.parse(readFileSync(extendsPath, "utf-8"));
      collectPathsInto(out, dirname(extendsPath), sub, visited);
    } catch {
      // extends file not readable; skip
    }
  }

  const opts = content.compilerOptions ?? {};
  const rawPaths = opts.paths;
  const baseUrl = opts.baseUrl;
  if (rawPaths && baseUrl) {
    const absBase = resolvePath(baseDir, baseUrl);
    for (const [alias, targets] of Object.entries(rawPaths)) {
      out[alias] = targets.map((t) => resolvePath(absBase, t));
    }
  }
}

function loadTsconfigPaths(startDir) {
  if (tsconfigPathsCache.has(startDir)) return tsconfigPathsCache.get(startDir);

  const paths = {};
  let dir = startDir;
  let prev = "";
  while (dir !== prev) {
    try {
      const content = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf-8"));
      collectPathsInto(paths, dir, content, new Set());
      break;
    } catch {
      // tsconfig.json not found in this directory; walk up
    }
    prev = dir;
    dir = dirname(dir);
  }

  tsconfigPathsCache.set(startDir, paths);
  return paths;
}

function matchTsconfigPath(specifier, paths) {
  for (const [alias, targets] of Object.entries(paths)) {
    if (alias.endsWith("/*")) {
      const prefix = alias.slice(0, -2);
      if (specifier.startsWith(prefix + "/")) {
        const rest = specifier.slice(prefix.length + 1);
        for (const target of targets) {
          return target.endsWith("/*") ? target.slice(0, -2) + "/" + rest : target;
        }
      }
    } else if (alias === specifier && targets.length > 0) {
      return targets[0];
    }
  }
  return null;
}

async function tryResolveWithExtensions(base, context, nextResolve) {
  for (const ext of TS_EXTENSIONS) {
    for (const suffix of ["", "/index"]) {
      try {
        return await nextResolve(base + suffix + ext, context);
      } catch (e) {
        if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
      }
    }
  }
  try {
    return await nextResolve(base, context);
  } catch (e) {
    if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
  }
  return null;
}

function tryResolveWithExtensionsSync(base, context, nextResolve) {
  for (const ext of TS_EXTENSIONS) {
    for (const suffix of ["", "/index"]) {
      try {
        return nextResolve(base + suffix + ext, context);
      } catch (e) {
        if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
      }
    }
  }
  try {
    return nextResolve(base, context);
  } catch (e) {
    if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
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
        const parentDir = dirname(fileURLToPath(context.parentURL));
        const tsconfigPaths = loadTsconfigPaths(parentDir);
        const mapped = matchTsconfigPath(specifier, tsconfigPaths);
        if (mapped) {
          const result = await tryResolveWithExtensions(
            pathToFileURL(mapped).href,
            context,
            nextResolve,
          );
          if (result) return result;
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
        const parentDir = dirname(fileURLToPath(context.parentURL));
        const tsconfigPaths = loadTsconfigPaths(parentDir);
        const mapped = matchTsconfigPath(specifier, tsconfigPaths);
        if (mapped) {
          const result = tryResolveWithExtensionsSync(
            pathToFileURL(mapped).href,
            context,
            nextResolve,
          );
          if (result) return result;
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
