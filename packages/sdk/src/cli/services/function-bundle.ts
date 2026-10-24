import * as path from "pathe";
import * as rolldown from "rolldown";
import { computeBundlerContextHash, withCache, type BundleCache } from "#/cli/cache/bundle-cache";
import { createStartTransformPlugin } from "#/cli/services/workflow/start-transformer";
import { createBundleLog } from "#/cli/shared/bundle-log";
import { createLogLevelTreeshakeOptions } from "#/cli/shared/bundle-log-level";
import {
  assertPackageRuntimeGlobalsAllowed,
  checkForbiddenRuntimeGlobals,
} from "#/cli/shared/forbidden-runtime-globals";
import {
  composeFunctionTreeshakeOptions,
  createUserTreeshakeOptions,
} from "#/cli/shared/function-treeshake";
import {
  createPlatformBundleDefinePlugin,
  type BundledDateRepresentations,
} from "#/cli/shared/platform-bundle-plugin";
import { chunkCodeWithSourcemap, type ProjectSourcesFilter } from "#/cli/shared/sourcemap-sources";
import { serializeStartContext, type StartContext } from "#/cli/shared/start-context";
import {
  createTsconfigPathsPlugin,
  type TsconfigLookupCache,
} from "#/cli/shared/tsconfig-paths-plugin";
import { createVirtualEntry } from "#/cli/shared/virtual-entry";
import type { AllowedRuntimeGlobals, LogLevel, TreeshakeOptions } from "#/configure/config/types";
import type { EffectiveDateDefault } from "#/runtime/types";

/**
 * Bundle settings shared by every function built in one CLI run
 */
export interface FunctionBundleSettings {
  /** Start context for workflow/job transformations */
  startContext?: StartContext;
  /** Optional bundle cache for skipping unchanged builds */
  cache?: BundleCache;
  /** Whether to enable inline sourcemaps */
  inlineSourcemap?: boolean;
  /** Whether inline sourcemaps embed the source text of installed packages */
  inlineSourcemapDependencySources?: boolean | string[];
  /** Which of the project's own sources keep their text in inline sourcemaps */
  inlineSourcemapProjectSources?: ProjectSourcesFilter;
  /** Controls which console calls are kept in bundled code */
  bundleLogLevel?: LogLevel;
  /** Overrides how unused code is removed from bundled code */
  bundleTreeshake?: TreeshakeOptions;
  /** Optional tsconfig lookup cache shared across bundles in this CLI run */
  tsconfigCache?: TsconfigLookupCache;
  /** Representation applied to `t` date fields that omit `as` */
  dateDefault?: EffectiveDateDefault;
}

interface RuntimeGlobalsCheck {
  /** Names the function in error messages */
  label: string;
  /** Globals each installed package may reference */
  allowed?: AllowedRuntimeGlobals;
}

/**
 * Options for bundling one function
 */
export interface BuildFunctionBundleOptions extends FunctionBundleSettings {
  /** Function kind, used for the cache key and the entry module ID */
  kind: "resolver" | "executor" | "workflow-job" | "auth-hook";
  /** Namespace the function name is unique within, if any */
  namespace?: string;
  /** Function name */
  name: string;
  /** File the entry imports the function from */
  sourceFile: string;
  /** tsconfig resolved for the owning config */
  tsconfig: string | undefined;
  /** Generates the entry module source. The source is part of the cache key, so this also runs on a cache hit and must have no side effects */
  entry: (absoluteSourcePath: string) => string;
  /** Creates the plugin that rewrites the function's sources before path resolution; defaults to the start transform */
  createTransformPlugin?: () => rolldown.Plugin | undefined;
  /** Date representations whose conversion code the bundle keeps */
  dateRepresentations?: BundledDateRepresentations;
  /** Expressions replaced with constants while bundling */
  define?: Record<string, string>;
  /** Rejects Node-only globals in the bundle, or `false` to skip the check */
  runtimeGlobals: RuntimeGlobalsCheck | false;
}

/**
 * Bundle one function entry with rolldown, restoring it from the bundle cache
 * when nothing it depends on changed.
 * @param options - Bundle options
 * @returns Bundled code
 */
export async function buildFunctionBundle(options: BuildFunctionBundleOptions): Promise<string> {
  const {
    kind,
    namespace,
    name,
    sourceFile,
    tsconfig,
    entry,
    createTransformPlugin,
    dateRepresentations,
    define,
    runtimeGlobals,
    startContext,
    cache,
    inlineSourcemap,
    inlineSourcemapDependencySources,
    inlineSourcemapProjectSources,
    bundleLogLevel = "DEBUG",
    bundleTreeshake,
    tsconfigCache,
    dateDefault = "legacy",
  } = options;

  const absoluteSourcePath = path.resolve(sourceFile);
  const entrySource = entry(absoluteSourcePath);
  const contextHash = computeBundlerContextHash({
    sourceFile,
    // The entry and the plugins fold in config values that live outside every
    // source file, so a cached bundle would otherwise survive a change to them.
    // Encoded as a tuple rather than joined, so no separator has to be a
    // character no value can contain.
    extraContext: JSON.stringify([serializeStartContext(startContext), entrySource, dateDefault]),
    tsconfig,
    inlineSourcemap,
    inlineSourcemapDependencySources,
    inlineSourcemapProjectSources,
    bundleLogLevel,
    bundleTreeshake,
  });

  const { code, packageRuntimeGlobals } = await withCache({
    cache,
    kind,
    namespace,
    name,
    sourceFile,
    contextHash,
    async build(cachePlugins, trackDependency) {
      const virtualEntry = createVirtualEntry(
        `${kind}:${name}`,
        entrySource,
        "js",
        absoluteSourcePath,
      );
      const transformPlugin = (
        createTransformPlugin ?? (() => createStartTransformPlugin(startContext))
      )();
      const plugins: rolldown.Plugin[] = [virtualEntry.plugin];
      if (transformPlugin) {
        plugins.push(transformPlugin);
      }
      plugins.push(
        createTsconfigPathsPlugin({ onTsconfigRead: trackDependency, cache: tsconfigCache }),
        createPlatformBundleDefinePlugin(dateRepresentations, dateDefault),
        ...cachePlugins,
      );

      const bundleLog = createBundleLog({ tsconfig });
      const result = await rolldown.build({
        input: virtualEntry.input,
        write: false,
        output: {
          format: "esm",
          sourcemap: true,
          minify: inlineSourcemap
            ? {
                mangle: {
                  keepNames: true,
                },
              }
            : true,
          codeSplitting: false,
        },
        tsconfig,
        plugins,
        ...(define && { transform: { define } }),
        treeshake: composeFunctionTreeshakeOptions([
          createLogLevelTreeshakeOptions(bundleLogLevel),
          createUserTreeshakeOptions(bundleTreeshake),
        ]),
        ...bundleLog.options,
      } as rolldown.BuildOptions);
      bundleLog.assertAllResolved();

      const [chunk] = result.output;
      return {
        code: chunkCodeWithSourcemap({
          chunk,
          inlineSourcemap: inlineSourcemap ?? false,
          dependencySources: inlineSourcemapDependencySources ?? false,
          projectSources: inlineSourcemapProjectSources,
        }),
        packageRuntimeGlobals: runtimeGlobals
          ? checkForbiddenRuntimeGlobals(chunk, runtimeGlobals.label)
          : {},
      };
    },
  });
  if (runtimeGlobals) {
    assertPackageRuntimeGlobalsAllowed(
      packageRuntimeGlobals,
      runtimeGlobals.label,
      runtimeGlobals.allowed,
    );
  }

  return code;
}
