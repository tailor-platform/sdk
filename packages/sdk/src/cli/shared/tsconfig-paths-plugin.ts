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
// Strictly a last resort. rolldown's `order: "post"` only orders this hook
// against other plugins — it still runs ahead of the builtin resolver, and a
// non-null return wins outright. So the handler asks rolldown to resolve the
// specifier first and bails out when that succeeds, which keeps a real
// node_modules package ahead of a `"*"` catch-all alias.

const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const JS_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"];

// A specifier already naming a JS-style output extension maps to the
// corresponding TypeScript source rather than having an extension appended.
const JS_TO_TS_EXT = new Map([
  [".js", ".ts"],
  [".jsx", ".tsx"],
  [".mjs", ".mts"],
  [".cjs", ".cts"],
]);

type ResolutionContext = {
  matcher: (specifier: string) => string[];
  allowJs: boolean;
};

export interface TsconfigPathsPluginOptions {
  /**
   * Source file a bundler's virtual entry was built from. An entry that inlines
   * user code carries the user's own import statements, so aliases in it must
   * resolve against that file's project rather than be skipped as SDK-injected.
   */
  virtualEntrySourceFile?: string;
}

/**
 * Create the rolldown plugin that resolves tsconfig `paths` aliases against the
 * importing file's own nearest tsconfig.
 * @param options - Resolution context for bundlers whose entry inlines user code
 * @returns Rolldown plugin to add to a bundler's plugin list
 */
export function createTsconfigPathsPlugin(
  options: TsconfigPathsPluginOptions = {},
): rolldown.Plugin {
  const tsconfigCache = new Map<string, TsConfigResult | null>();
  const contextCache = new Map<string, ResolutionContext | null>();

  return {
    name: "tailor-sdk-tsconfig-paths",
    resolveId: {
      order: "post",
      async handler(source, importer) {
        if (!importer) return null;
        if (source.startsWith(".") || source.startsWith("/") || source.startsWith("\0")) {
          return null;
        }

        const resolutionBasis = importer.startsWith("\0")
          ? options.virtualEntrySourceFile
          : importer;
        if (!resolutionBasis) return null;

        const resolution = getResolutionContext(
          path.dirname(resolutionBasis),
          tsconfigCache,
          contextCache,
        );
        if (!resolution) return null;

        const alreadyResolvable = await this.resolve(source, importer, { skipSelf: true });
        if (alreadyResolvable) return null;

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
// whole shadowing problem — so keep walking up until one actually declares
// `paths`. The walk cannot stop at the first tsconfig `createPathsMatcher`
// accepts: it also accepts a `baseUrl`-only config, whose matcher maps every
// bare specifier to a `baseUrl`-relative guess.
//
// `allowJs` stays bound to the importing file's own nearest tsconfig, since it
// is a property of that file's project rather than of whichever ancestor
// happens to own the alias table.
function getResolutionContext(
  startDir: string,
  tsconfigCache: Map<string, TsConfigResult | null>,
  contextCache: Map<string, ResolutionContext | null>,
): ResolutionContext | null {
  const cached = contextCache.get(startDir);
  if (cached !== undefined) return cached;

  let searchDir = startDir;
  let allowJs: boolean | undefined;
  let resolution: ResolutionContext | null = null;
  for (;;) {
    const tsconfig = getTsconfig(searchDir, "tsconfig.json", tsconfigCache);
    if (!tsconfig) break;

    allowJs ??= tsconfig.config.compilerOptions?.allowJs ?? false;

    if (tsconfig.config.compilerOptions?.paths) {
      const matcher = createPathsMatcher(tsconfig);
      if (matcher) {
        resolution = { matcher, allowJs };
        break;
      }
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
