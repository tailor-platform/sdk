import { type Cache, createPathsMatcher, getTsconfig } from "get-tsconfig";
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

type ResolutionContext = {
  matcher: (specifier: string) => string[];
};

export interface TsconfigPathsPluginOptions {
  /**
   * Source file a bundler's virtual entry was built from. A virtual entry has no
   * directory of its own to resolve against, so an entry that inlines the user's
   * own import statements must name the file they came from.
   */
  virtualEntrySourceFile?: string;
  /**
   * Called with each file path the tsconfig lookup depends on, including config
   * candidates that do not exist yet and package metadata used to resolve an
   * `extends` target. A cached bundler must treat these as inputs: tsconfigs are
   * never loaded as modules, so nothing else notices when an ancestor's `paths`
   * table changes or a nearer tsconfig.json appears.
   */
  onTsconfigRead?: (tsconfigPath: string) => void;
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
  const tsconfigCache: Cache = new Map();
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

        // Deliberately ahead of the resolvability check below: the lookup reports
        // the tsconfigs this import depends on, and a caching bundler needs them
        // even when the import resolves without any alias today. Editing those
        // tsconfigs later can change the outcome.
        const resolution = getResolutionContext(
          path.dirname(resolutionBasis),
          tsconfigCache,
          contextCache,
          options.onTsconfigRead,
        );
        if (!resolution) return null;

        const alreadyResolvable = await this.resolve(source, importer, { skipSelf: true });
        if (alreadyResolvable) return null;

        // Each mapped candidate goes back through rolldown as an absolute
        // specifier, so extension substitution, directory index files and
        // `package.json` `main`/`exports` all behave exactly as they do for a
        // relative import. Probing the filesystem here instead would have to
        // restate those rules and would drift from them.
        for (const candidate of resolution.matcher(source)) {
          const resolved = await this.resolve(candidate, importer, { skipSelf: true });
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
function getResolutionContext(
  startDir: string,
  tsconfigCache: Cache,
  contextCache: Map<string, ResolutionContext | null>,
  onTsconfigRead?: (tsconfigPath: string) => void,
): ResolutionContext | null {
  const cached = contextCache.get(startDir);
  if (cached !== undefined) return cached;

  let searchDir = startDir;
  let resolution: ResolutionContext | null = null;
  for (;;) {
    const tsconfig = getTsconfig(searchDir, "tsconfig.json", tsconfigCache);
    reportTsconfigDependencies(tsconfigCache, onTsconfigRead);
    if (!tsconfig) break;

    const paths = tsconfig.config.compilerOptions?.paths;
    if (paths && Object.keys(paths).length > 0) {
      const matcher = createPathsMatcher(tsconfig);
      if (matcher) {
        resolution = { matcher };
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

function reportTsconfigDependencies(
  cache: Cache,
  onTsconfigRead?: (tsconfigPath: string) => void,
): void {
  if (!onTsconfigRead) return;

  const directories = new Set<string>();
  const dependencies = new Set<string>();
  for (const [key, value] of cache) {
    const dependencyPath = dependencyPathFromCacheKey(key);
    if (!dependencyPath) continue;
    if (key.startsWith("statSync:") && isDirectoryStat(value)) {
      directories.add(dependencyPath);
    } else {
      dependencies.add(dependencyPath);
    }
  }
  for (const dependencyPath of dependencies) {
    if (!directories.has(dependencyPath)) onTsconfigRead(dependencyPath);
  }
}

function dependencyPathFromCacheKey(key: string): string | undefined {
  const readFilePrefix = "readFileSync:";
  const readFileSuffix = ":utf8";
  if (key.startsWith(readFilePrefix) && key.endsWith(readFileSuffix)) {
    return key.slice(readFilePrefix.length, -readFileSuffix.length);
  }
  for (const prefix of ["existsSync:", "statSync:"]) {
    if (key.startsWith(prefix)) return key.slice(prefix.length);
  }
  return undefined;
}

function isDirectoryStat(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "isDirectory" in value &&
    typeof value.isDirectory === "function" &&
    value.isDirectory()
  );
}
