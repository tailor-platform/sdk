import * as fs from "node:fs";
import { builtinModules } from "node:module";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { computeBundlerContextHash, withCache, type BundleCache } from "@/cli/cache/bundle-cache";
import { getDistDir } from "@/cli/shared/dist-dir";
import { logger, styles } from "@/cli/shared/logger";
import type { HttpMethodKey } from "@/types/http-adapter";

const ADAPTER_BUNDLE_WARN_BYTES = 64 * 1024;
const ADAPTER_BUNDLE_ERROR_BYTES = 256 * 1024;

// Sobek does not implement Node's host APIs. Reject every Node built-in
// (including subpath imports like `fs/promises`) and the `node:` prefix.
// Internal `_*` modules are excluded since they are never valid user imports.
const NODE_BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith("_")));

function isNodeBuiltinImport(source: string): boolean {
  if (source.startsWith("node:")) return true;
  const root = source.includes("/") ? source.slice(0, source.indexOf("/")) : source;
  return NODE_BUILTINS.has(root);
}

export interface HttpAdapterBundleInput {
  name: string;
  sourceFile: string;
  methods: HttpMethodKey[];
  hasOutput: boolean;
}

export interface HttpAdapterBundleResult {
  /** Adapter name → bundled input JS string. */
  bundledInputs: Map<string, string>;
  /** Adapter name → bundled output JS string. Only populated when the adapter has an output. */
  bundledOutputs: Map<string, string>;
}

/**
 * Bundle each HTTP adapter's `input` (and `output`, if present) function into a
 * single JS string that defines a global `transform(input)` entry point.
 *
 * For `input`, the SDK generates a method dispatcher: at runtime the gateway
 * passes the HTTP request (with `method` in uppercase) and the wrapper routes
 * it to the user's per-method handler. For `output`, the user's function is
 * used directly.
 *
 * The output targets the gateway's Sobek runtime: ES2017 IIFE, no Node imports,
 * no async/await, single file (no code splitting). Each function is bundled
 * separately so the runtime can run them independently.
 * @param adapters - Detected adapters to bundle
 * @param cache - Optional bundle cache for skipping unchanged builds
 * @returns Bundled scripts keyed by adapter name
 */
export async function bundleHttpAdapters(
  adapters: HttpAdapterBundleInput[],
  cache?: BundleCache,
): Promise<HttpAdapterBundleResult> {
  if (adapters.length === 0) {
    return { bundledInputs: new Map(), bundledOutputs: new Map() };
  }

  logger.newline();
  logger.log(
    `Bundling ${styles.highlight(adapters.length.toString())} files for ${styles.info('"http-adapter"')}`,
  );

  const outputDir = path.resolve(getDistDir(), "http-adapters");
  fs.mkdirSync(outputDir, { recursive: true });

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  const results = await Promise.all(
    adapters.flatMap((adapter) => {
      const tasks: Array<Promise<[string, "input" | "output", string]>> = [
        bundleAdapterScript(adapter, "input", outputDir, tsconfig, cache),
      ];
      if (adapter.hasOutput) {
        tasks.push(bundleAdapterScript(adapter, "output", outputDir, tsconfig, cache));
      }
      return tasks;
    }),
  );

  const bundledInputs = new Map<string, string>();
  const bundledOutputs = new Map<string, string>();
  for (const [name, kind, code] of results) {
    if (kind === "input") {
      bundledInputs.set(name, code);
    } else {
      bundledOutputs.set(name, code);
    }
  }

  logger.log(`${styles.success("Bundled")} ${styles.info('"http-adapter"')}`);

  return { bundledInputs, bundledOutputs };
}

async function bundleAdapterScript(
  adapter: HttpAdapterBundleInput,
  kind: "input" | "output",
  outputDir: string,
  tsconfig: string | undefined,
  cache: BundleCache | undefined,
): Promise<[string, "input" | "output", string]> {
  const contextHash = computeBundlerContextHash({
    sourceFile: adapter.sourceFile,
    serializedTriggerContext: kind === "input" ? adapter.methods.join(",") : "",
    tsconfig,
    inlineSourcemap: false,
    prefix: kind,
  });

  const code = await withCache({
    cache,
    kind: kind === "input" ? "http-adapter-input" : "http-adapter-output",
    name: adapter.name,
    sourceFile: adapter.sourceFile,
    contextHash,
    async build(cachePlugins) {
      const entryPath = path.join(outputDir, `${adapter.name}.${kind}.entry.js`);
      const absoluteSourcePath = path.resolve(adapter.sourceFile);

      const entryContent =
        kind === "input"
          ? buildInputEntry(absoluteSourcePath, adapter.methods)
          : buildOutputEntry(absoluteSourcePath);
      fs.writeFileSync(entryPath, entryContent);

      const rejectNodeImports: rolldown.Plugin = {
        name: "http-adapter-reject-node-imports",
        resolveId(source) {
          if (isNodeBuiltinImport(source)) {
            throw new Error(
              `HTTP adapter "${adapter.name}" imports Node module "${source}", which is unavailable in the gateway runtime`,
            );
          }
          return null;
        },
      };

      // The SDK only contributes the `createHttpAdapter` brand at build time;
      // at gateway runtime we just need the user's handler bodies. Replace any
      // `@tailor-platform/sdk` import with a tiny stub so the IIFE output has
      // no external global dependency.
      const stubSdkImports: rolldown.Plugin = {
        name: "http-adapter-stub-sdk",
        resolveId(source) {
          if (source === "@tailor-platform/sdk" || source.startsWith("@tailor-platform/sdk/")) {
            return { id: "\0http-adapter-sdk-stub", moduleSideEffects: false };
          }
          return null;
        },
        load(id) {
          if (id === "\0http-adapter-sdk-stub") {
            return "export const createHttpAdapter = (cfg) => cfg;\nexport default { createHttpAdapter };\n";
          }
          return null;
        },
      };

      const plugins: rolldown.Plugin[] = [rejectNodeImports, stubSdkImports, ...cachePlugins];

      let bundled: string;
      try {
        const result = await rolldown.build({
          input: entryPath,
          write: false,
          output: {
            format: "iife",
            sourcemap: false,
            minify: true,
            codeSplitting: false,
          },
          tsconfig,
          plugins,
          transform: { target: "es2017" },
          treeshake: {
            moduleSideEffects: false,
            annotations: true,
            unknownGlobalSideEffects: false,
          },
          logLevel: "silent",
        } as rolldown.BuildOptions);
        bundled = result.output[0].code;
      } finally {
        try {
          fs.rmSync(entryPath, { force: true });
        } catch {
          // best-effort cleanup
        }
      }

      const byteLength = Buffer.byteLength(bundled, "utf8");
      if (byteLength > ADAPTER_BUNDLE_ERROR_BYTES) {
        throw new Error(
          `HTTP adapter "${adapter.name}" ${kind} script is ${byteLength} bytes, exceeding the ${ADAPTER_BUNDLE_ERROR_BYTES} byte limit`,
        );
      }
      if (byteLength > ADAPTER_BUNDLE_WARN_BYTES) {
        logger.warn(
          `HTTP adapter "${adapter.name}" ${kind} script is ${byteLength} bytes, larger than the recommended ${ADAPTER_BUNDLE_WARN_BYTES} byte limit`,
        );
      }

      return bundled;
    },
  });

  return [adapter.name, kind, code];
}

function buildInputEntry(absoluteSourcePath: string, methods: HttpMethodKey[]): string {
  const cases = methods
    .map((method) => `    case "${method.toUpperCase()}": return __adapter.input.${method}(req);`)
    .join("\n");
  const supported = methods.map((m) => m.toUpperCase()).join(", ");
  return `import __adapter from ${JSON.stringify(absoluteSourcePath)};
globalThis.transform = function(req) {
  switch (req.method) {
${cases}
    default: throw new Error("HTTP adapter received unsupported method: " + req.method + " (supported: ${supported})");
  }
};
`;
}

function buildOutputEntry(absoluteSourcePath: string): string {
  return `import __adapter from ${JSON.stringify(absoluteSourcePath)};
globalThis.transform = __adapter.output;
`;
}
