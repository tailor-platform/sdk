import * as fs from "node:fs";
import { createPathsMatcher, getTsconfig, type TsConfigResult } from "get-tsconfig";
import * as path from "pathe";
import type * as rolldown from "rolldown";

// A bundler hands rolldown a single tsconfig, so rolldown applies one `paths`
// table to every module in the graph. When a project nests a tsconfig.json
// without `paths` nearer to an imported file, that nested tsconfig wins and the
// aliases declared in the project root stop resolving — the bundle-time twin of
// the runtime gap `cli/tsconfig-paths-hook.mjs` closes for dynamic imports.
// This plugin re-derives the `paths` matcher from each importing file's own
// directory, so an alias resolves against its own project's tsconfig.
//
// Runs as a fallback: `resolveId` returns null unless rolldown's own resolution
// already failed, so a real package always wins over an alias pattern (a `"*"`
// catch-all must not shadow node_modules).

const TS_EXTENSIONS = [".ts", ".tsx", ".mts"];
const JS_EXTENSIONS = [".js", ".jsx", ".mjs"];

// A specifier already naming a JS-style output extension maps to the
// corresponding TypeScript source rather than having an extension appended.
const JS_TO_TS_EXT = new Map([
  [".js", ".ts"],
  [".jsx", ".tsx"],
  [".mjs", ".mts"],
]);

type ResolutionContext = {
  matcher: (specifier: string) => string[];
  allowJs: boolean;
};

/**
 * Create the rolldown plugin that resolves tsconfig `paths` aliases against the
 * importing file's own nearest tsconfig.
 * @returns Rolldown plugin to add to a bundler's plugin list
 */
export function createTsconfigPathsPlugin(): rolldown.Plugin {
  const tsconfigCache = new Map<string, TsConfigResult | null>();
  const contextCache = new Map<string, ResolutionContext | null>();

  return {
    name: "tailor-sdk-tsconfig-paths",
    resolveId: {
      // `post` so this only runs after rolldown's own resolution came up empty.
      order: "post",
      handler(source, importer) {
        if (!importer) return null;
        if (source.startsWith(".") || source.startsWith("/") || source.startsWith("\0"))
          return null;
        if (importer.startsWith("\0")) return null;

        const resolution = getResolutionContext(
          path.dirname(importer),
          tsconfigCache,
          contextCache,
        );
        if (!resolution) return null;

        for (const candidate of resolution.matcher(source)) {
          const resolved = resolveCandidate(candidate, resolution.allowJs);
          if (resolved) return resolved;
        }
        return null;
      },
    },
  };
}

// The nearest tsconfig.json is often the one that lacks `paths` — that is the
// whole shadowing problem — so keep walking up past every tsconfig that
// declares none until one yields a matcher.
function getResolutionContext(
  startDir: string,
  tsconfigCache: Map<string, TsConfigResult | null>,
  contextCache: Map<string, ResolutionContext | null>,
): ResolutionContext | null {
  const cached = contextCache.get(startDir);
  if (cached !== undefined) return cached;

  let searchDir = startDir;
  let resolution: ResolutionContext | null = null;
  for (;;) {
    const tsconfig = getTsconfig(searchDir, "tsconfig.json", tsconfigCache);
    if (!tsconfig) break;

    const matcher = createPathsMatcher(tsconfig);
    if (matcher) {
      resolution = { matcher, allowJs: tsconfig.config.compilerOptions?.allowJs ?? false };
      break;
    }

    const parentDir = path.dirname(path.dirname(tsconfig.path));
    if (parentDir === searchDir) break;
    searchDir = parentDir;
  }

  contextCache.set(startDir, resolution);
  return resolution;
}

function resolveCandidate(candidate: string, allowJs: boolean): string | null {
  for (const [jsExt, tsExt] of JS_TO_TS_EXT) {
    if (candidate.endsWith(jsExt)) {
      const source = `${candidate.slice(0, -jsExt.length)}${tsExt}`;
      return firstExistingFile([source, candidate]);
    }
  }

  if (TS_EXTENSIONS.some((ext) => candidate.endsWith(ext))) {
    return firstExistingFile([candidate]);
  }

  // TypeScript resolves a file at the path before a directory's index file.
  const extensions = allowJs ? [...TS_EXTENSIONS, ...JS_EXTENSIONS] : TS_EXTENSIONS;
  const withExtensions = ["", "/index"].flatMap((suffix) =>
    extensions.map((ext) => `${candidate}${suffix}${ext}`),
  );
  return firstExistingFile([...withExtensions, candidate]);
}

function firstExistingFile(candidates: string[]): string | null {
  return candidates.find(isFile) ?? null;
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
