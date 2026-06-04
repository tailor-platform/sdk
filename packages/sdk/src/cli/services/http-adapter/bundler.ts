import * as fs from "node:fs";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { computeBundlerContextHash, withCache, type BundleCache } from "@/cli/cache/bundle-cache";
import { isNodeBuiltinImport } from "@/cli/services/http-adapter/node-builtins";
import { withBundleConcurrency } from "@/cli/shared/bundle-concurrency";
import { getDistDir } from "@/cli/shared/dist-dir";
import { logger, styles } from "@/cli/shared/logger";
import { HTTP_METHODS, type HttpMethodKey } from "@/parser/service/http-adapter";

const ADAPTER_BUNDLE_WARN_BYTES = 64 * 1024;
const ADAPTER_BUNDLE_ERROR_BYTES = 256 * 1024;

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
 * Bundle each adapter's `input` (and `output`, if present) into a standalone
 * IIFE defining a global `transform(input)` entry point. `input` gets a
 * generated dispatcher that routes by `req.method`; `output` is used as is.
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

  // rolldown.build() is memory-intensive; cap parallelism like the other SDK bundlers.
  const tasks = adapters.flatMap((adapter) => {
    const kinds: Array<"input" | "output"> = adapter.hasOutput ? ["input", "output"] : ["input"];
    return kinds.map((kind) => ({ adapter, kind }));
  });
  const results = await withBundleConcurrency(tasks, ({ adapter, kind }) =>
    bundleAdapterScript(adapter, kind, outputDir, tsconfig, cache),
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

      // Stub out `@tailor-platform/sdk` imports: only the brand matters at
      // build time, and the IIFE must not depend on external globals.
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
          // es2017 on purpose: async/await must survive downleveling so
          // rejectAsyncInBundle can reject it (lower targets rewrite it into
          // generator+Promise code that evades the check and breaks on Sobek).
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

      // Load-time checks only see the handler functions; imported helpers can
      // still introduce async/await, so verify the whole bundle is synchronous.
      rejectAsyncInBundle(bundled, adapter.name, kind);

      return bundled;
    },
  });

  return [adapter.name, kind, code];
}

function buildInputEntry(absoluteSourcePath: string, methods: HttpMethodKey[]): string {
  const cases = methods
    .map((method) => `    case "${HTTP_METHODS[method]}": return __adapter.input.${method}(req);`)
    .join("\n");
  const supported = methods.map((m) => HTTP_METHODS[m]).join(", ");
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

function rejectAsyncInBundle(code: string, adapterName: string, kind: "input" | "output"): void {
  // Use a fake filename so oxc treats this as a module. The bundle is already
  // minified IIFE; oxc parses it without complaint.
  const { program } = parseSync(`${adapterName}.${kind}.bundle.js`, code);

  let asyncFound = false;
  const stack: unknown[] = [program];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    const type = typeof n.type === "string" ? (n.type as string) : "";
    if (type === "AwaitExpression") {
      asyncFound = true;
      break;
    }
    if (
      (type === "FunctionDeclaration" ||
        type === "FunctionExpression" ||
        type === "ArrowFunctionExpression") &&
      n.async === true
    ) {
      asyncFound = true;
      break;
    }
    if ((type === "ForOfStatement" || type === "ForStatement") && n.await === true) {
      asyncFound = true;
      break;
    }
    for (const key of Object.keys(n)) {
      const child = n[key];
      if (Array.isArray(child)) {
        for (const c of child) stack.push(c);
      } else if (child && typeof child === "object") {
        stack.push(child);
      }
    }
  }

  if (asyncFound) {
    throw new Error(
      `HTTP adapter "${adapterName}" ${kind} bundle contains async/await, which is unavailable in the gateway runtime. ` +
        `Check imported helper modules — even if your handler is synchronous, an async helper will fail at runtime.`,
    );
  }
}
