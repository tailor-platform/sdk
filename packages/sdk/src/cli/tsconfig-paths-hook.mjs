import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPathsMatcher, getTsconfig } from "get-tsconfig";

// Resolve-only Node.js module hook: fixes tsconfig `paths` alias resolution
// for dynamically-imported user files (resolvers, executors, workflows,
// TailorDB types). tsx's own tsconfig-paths support is scoped to the
// tsconfig discovered relative to where tsx itself was registered, so an
// alias declared in a project-local tsconfig.json can fail to resolve when
// the imported file lives in a different directory. This hook activates
// only when tsx's own resolution throws (a fallback, not an override): it
// then re-derives the effective `paths` matcher from the importing file's
// own directory, so the fallback resolves against each file's own
// project's tsconfig regardless of process cwd or which other
// tsconfig-bearing projects have already been loaded in the same process.
//
// Known limitation: if tsx's cwd-scoped tsconfig happens to define the
// same alias pattern as the importing file's own tsconfig (e.g. both share
// a `@/*` convention) and a file exists at the guessed target, tsx's own
// resolution succeeds — incorrectly — before this fallback ever runs.
// Winning that race would require this hook to run ahead of tsx's own
// resolution, which was investigated and found to depend on undocumented,
// inconsistent Node.js module-hook composition behavior between tsx's two
// internal registration APIs; not attempted here.
//
// Registered via module.register() (not module.registerHooks()): tsx picks
// between the async register() and sync registerHooks() APIs internally
// depending on the Node.js version, and a sync-registered hook's nextResolve
// never reaches back into an active register()-based loader chain — it
// would silently never fire on the Node.js versions where tsx still uses
// register(). Chaining another register()-based loader after tsx's,
// regardless of which API tsx itself picked, is the only combination that
// composes correctly on every supported Node.js version.
//
// TypeScript transformation itself is left to tsx's already-registered load
// hook; this only supplies the resolve fallback tsx's cwd-scoped resolver
// misses.

const TS_EXTENSIONS = [".ts", ".tsx", ".mts"];

const tsconfigCache = new Map();
const matcherCache = new Map();

function getMatcher(startDir) {
  if (matcherCache.has(startDir)) return matcherCache.get(startDir);

  const tsconfig = getTsconfig(startDir, "tsconfig.json", tsconfigCache);
  const matcher = tsconfig ? createPathsMatcher(tsconfig) : null;

  matcherCache.set(startDir, matcher);
  return matcher;
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

// Hook for module.register(). Only handles the case default resolution
// (including tsx's own tsconfig-paths support) already failed on: a
// non-relative bare specifier that maps to a tsconfig `paths` alias declared
// by a tsconfig.json above the importing file's own directory. Relative
// imports and anything tsx/Node already resolves are left alone.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    if (specifier.startsWith(".") || specifier.startsWith("/")) throw err;
    if (!context.parentURL?.startsWith("file://")) throw err;

    const parentParsed = new URL(context.parentURL);
    parentParsed.search = "";
    parentParsed.hash = "";
    const parentDir = dirname(fileURLToPath(parentParsed));

    const matcher = getMatcher(parentDir);
    if (!matcher) throw err;
    const candidates = matcher(specifier);
    if (!candidates || candidates.length === 0) throw err;

    for (const candidatePath of candidates) {
      const result = await tryResolveWithExtensions(
        pathToFileURL(candidatePath).href,
        context,
        nextResolve,
      );
      if (result) return result;
    }
    throw err;
  }
}
