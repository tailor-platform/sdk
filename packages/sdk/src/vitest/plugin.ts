import { dirname, isAbsolute, matchesGlob, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isBlockedModule, getBlockedMessage } from "./blocked-modules";
import type { Plugin, ResolvedConfig } from "vite";

const DEFAULT_TEST_INCLUDE = ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"];

interface ExportSpecifierNode {
  type?: string;
  exported?: { name?: unknown } | null;
}

interface ImportLikeNode {
  type: string;
  start: number;
  end: number;
  source?: { value?: unknown } | null;
  specifiers?: ExportSpecifierNode[] | null;
  exported?: { name?: unknown } | null;
}

const IMPORT_LIKE_TYPES = new Set([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
]);

function buildBlockedReplacement(node: ImportLikeNode, message: string): string {
  const throwStmt = `throw new Error("${message}");`;
  const throwExpr = `(() => { throw new Error("${message}"); })()`;

  if (node.type === "ExportNamedDeclaration") {
    const specs = node.specifiers ?? [];
    const stubs: string[] = [];
    for (const spec of specs) {
      const exportedName = spec.exported?.name;
      if (typeof exportedName !== "string") continue;
      stubs.push(
        exportedName === "default"
          ? `export default ${throwExpr};`
          : `export const ${exportedName} = ${throwExpr};`,
      );
    }
    return stubs.length > 0 ? stubs.join(" ") : throwStmt;
  }

  if (node.type === "ExportAllDeclaration") {
    const exportedName = node.exported?.name;
    if (typeof exportedName === "string") {
      return `export const ${exportedName} = ${throwExpr};`;
    }
    return throwStmt;
  }

  return throwStmt;
}

/**
 * Vite plugin that blocks Node.js built-in module imports from production code.
 *
 * Uses the `transform` hook to walk the Rollup-provided AST of non-test source
 * files for static `node:*` imports and re-exports.
 * `ImportDeclaration` and bare `export * from "..."` are replaced with a
 * `throw new Error(...)` statement so the failure surfaces at evaluation time.
 * `ExportNamedDeclaration` (`export { x, y as z } from "..."`) and namespaced
 * `export * as ns from "..."` are rewritten to per-binding stub exports
 * (`export const x = (() => { throw new Error(...) })();`). The IIFE throws
 * eagerly during module evaluation (same timing as a top-level `throw`), but
 * preserving the declared export bindings ensures the surfaced error is the
 * actual "node:* not available" message rather than an opaque
 * "missing export" raised by the loader.
 * Vitest treats `node:*` as external SSR modules (skipping `resolveId`), so
 * source-level transformation is the only reliable interception point.
 * Runs in the default phase (no `enforce: "pre"`) so esbuild's TypeScript
 * transform strips `import type` first; only runtime imports reach this hook.
 * Node.js globals not in the platform runtime are removed by the environment (whitelist-based).
 * Test file patterns are read from the resolved Vitest config (`test.include`).
 * Vitest setup files (`test.setupFiles`) and global-setup files
 * (`test.globalSetup`) are also exempted: they run in the test runner host,
 * not in the emulated platform runtime, so they may freely use `node:*`
 * modules (e.g. `node:url` for `pathToFileURL`).
 * @returns Vite plugin
 */
export function createBlockPlugin(): Plugin {
  let isTestFile: (id: string) => boolean = () => false;
  let isUserSourceFile: (id: string) => boolean = () => false;

  return {
    name: "tailor-runtime-block-node",

    configResolved(config: ResolvedConfig) {
      const testConfig = (
        config as ResolvedConfig & {
          test?: {
            include?: string[];
            setupFiles?: string | string[];
            globalSetup?: string | string[];
            root?: string;
          };
        }
      ).test;
      const root = testConfig?.root ?? config.root;
      const patterns = testConfig?.include ?? DEFAULT_TEST_INCLUDE;
      // Setup files and global-setup files run in the Vitest host (not the
      // emulated runtime), so they may freely import node:* modules.
      const toAbsoluteSet = (value: string | string[] | undefined) =>
        new Set((Array.isArray(value) ? value : value ? [value] : []).map((f) => resolve(root, f)));
      const exemptHostFiles = new Set([
        ...toAbsoluteSet(testConfig?.setupFiles),
        ...toAbsoluteSet(testConfig?.globalSetup),
      ]);
      isTestFile = (id: string) => {
        if (exemptHostFiles.has(id)) return true;
        const candidate = isAbsolute(id) ? relative(root, id) : id;
        return patterns.some((pattern) => matchesGlob(candidate, pattern));
      };
      // Only transform files inside the project root. With pnpm workspaces,
      // dependencies are symlinked and Vite resolves them to absolute paths
      // outside `node_modules`, so the substring check alone is insufficient.
      // Non-absolute ids are Vite-internal: virtual modules (`\0...`,
      // `virtual:...`), bare specifiers, etc. Those are never user source
      // files and must not be parsed/transformed.
      isUserSourceFile = (id: string) => {
        if (!isAbsolute(id)) return false;
        const rel = relative(root, id);
        return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      };
    },

    transform(code, id) {
      if (isTestFile(id)) return undefined;
      if (id.includes("node_modules")) return undefined;
      if (!isUserSourceFile(id)) return undefined;

      let ast: { body: ImportLikeNode[] };
      try {
        ast = this.parse(code) as unknown as { body: ImportLikeNode[] };
      } catch {
        // Not parseable as ESM (e.g. JSON, asset). Let other plugins handle it.
        return undefined;
      }

      const replacements: { start: number; end: number; replacement: string }[] = [];
      for (const node of ast.body) {
        if (!IMPORT_LIKE_TYPES.has(node.type)) continue;
        const specifier = node.source?.value;
        if (typeof specifier !== "string") continue;
        if (isBlockedModule(specifier)) {
          const message = getBlockedMessage(specifier).replace(/"/g, '\\"');
          replacements.push({
            start: node.start,
            end: node.end,
            replacement: buildBlockedReplacement(node, message),
          });
        }
      }

      if (replacements.length === 0) return undefined;

      let transformed = code;
      for (const r of replacements.sort((a, b) => b.start - a.start)) {
        transformed = transformed.slice(0, r.start) + r.replacement + transformed.slice(r.end);
      }

      return { code: transformed, map: null };
    },
  };
}

const ENVIRONMENT_NAME = "tailor-runtime";

/**
 * Vite plugin that resolves the tailor-runtime environment and injects setup files.
 *
 * Vitest resolves environments starting with "." or "/" as file paths.
 * This plugin rewrites `environment: "tailor-runtime"` to the absolute path
 * of the bundled environment module, both at the top-level and per-project.
 * It also injects the setup file that removes Vitest-dependent globals
 * (like `performance`) per-test via beforeEach/afterEach hooks.
 * @param options - Optional configuration
 * @param options.config - Path to tailor.config.ts to load SecretManager values into mock
 * @returns Vite plugin
 */
export function createEnvironmentPlugin(options?: { config?: string }): Plugin {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const environmentPath = resolve(currentDir, "environment.mjs");
  const setupPath = resolve(currentDir, "setup.mjs");

  return {
    name: "tailor-runtime-environment",

    config(config) {
      const testConfig = config.test as
        | (Record<string, unknown> & {
            projects?: Record<string, unknown>[];
            setupFiles?: string | string[];
          })
        | undefined;

      // Rewrite environment name to absolute path at top-level
      if (testConfig?.environment === ENVIRONMENT_NAME) {
        testConfig.environment = environmentPath;
      }

      // Rewrite in each project config
      if (testConfig?.projects) {
        for (const project of testConfig.projects) {
          const projectTest = project.test as Record<string, unknown> | undefined;
          if (projectTest?.environment === ENVIRONMENT_NAME) {
            projectTest.environment = environmentPath;
          }
        }
      }

      // Pass config path to setup.ts via env var (cross-process compatible)
      if (options?.config) {
        const configAbsPath = resolve(process.cwd(), options.config);
        process.env.__TAILOR_RUNTIME_CONFIG = configAbsPath;
      }

      // Normalize a user-provided string `setupFiles` into an array so Vite's
      // array-concat merge sees both sides as arrays (the string form would
      // otherwise be replaced rather than concatenated by some merge paths).
      // Vite then concatenates the user's array with our [setupPath].
      if (testConfig && typeof testConfig.setupFiles === "string") {
        testConfig.setupFiles = [testConfig.setupFiles];
      }

      return {
        test: {
          setupFiles: [setupPath],
        },
      };
    },
  };
}
