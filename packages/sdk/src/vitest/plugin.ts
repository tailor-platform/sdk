import { dirname, isAbsolute, matchesGlob, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isBlockedModule, getBlockedMessage } from "./blocked-modules";
import type { Plugin } from "vitest/config";

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

// Re-export specifiers (`export { x as Y } from "..."`) accept any
// `IdentifierName` for `Y` — including reserved words like `delete`. But
// `export const Y = ...` requires a `BindingIdentifier`, which forbids
// reserved words and the strict-mode-banned `arguments` / `eval`. Synthesizing
// `export const delete = ...` would yield a syntax error, so we fall back to
// plain `throw` for unsafe names.
const UNSAFE_BINDING_NAMES = new Set([
  // ReservedWord (ES2022+)
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  // Strict-mode reserved (ESM is always strict)
  "let",
  "static",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  // Module-specific reserved
  "await",
  // Banned as binding names in strict mode
  "arguments",
  "eval",
]);

const ID_START = /^[A-Za-z_$]/;
const ID_CONT = /^[A-Za-z0-9_$]*$/;

function isSafeBindingName(name: string): boolean {
  if (UNSAFE_BINDING_NAMES.has(name)) return false;
  if (name.length === 0) return false;
  // Restrict to ASCII identifiers — Unicode bindings are valid JS but rare
  // for re-exports of node:* modules, and a regex over the full
  // ID_Start/ID_Continue sets adds substantial weight for marginal gain.
  return ID_START.test(name[0] ?? "") && ID_CONT.test(name.slice(1));
}

function buildBlockedReplacement(node: ImportLikeNode, message: string): string {
  // JSON.stringify yields a fully-escaped string literal (including the
  // surrounding quotes), so we don't need to manually handle backslashes,
  // newlines, or other control characters that may appear in the message.
  const literal = JSON.stringify(message);
  const throwStmt = `throw new Error(${literal});`;
  const throwExpr = `(() => { throw new Error(${literal}); })()`;

  if (node.type === "ExportNamedDeclaration") {
    const specs = node.specifiers ?? [];
    const stubs: string[] = [];
    for (const spec of specs) {
      const exportedName = spec.exported?.name;
      if (typeof exportedName !== "string") continue;
      if (exportedName === "default") {
        stubs.push(`export default ${throwExpr};`);
        continue;
      }
      // Reserved words can be re-export names but not binding names.
      // Bail to a plain throw rather than emit invalid syntax.
      if (!isSafeBindingName(exportedName)) return throwStmt;
      stubs.push(`export const ${exportedName} = ${throwExpr};`);
    }
    return stubs.length > 0 ? stubs.join(" ") : throwStmt;
  }

  if (node.type === "ExportAllDeclaration") {
    const exportedName = node.exported?.name;
    if (typeof exportedName === "string" && isSafeBindingName(exportedName)) {
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

    configResolved(config) {
      type HostFileTestConfig = {
        include?: string[];
        setupFiles?: string | string[];
        globalSetup?: string | string[];
        root?: string;
      };
      const testConfig = (
        config as typeof config & {
          test?: HostFileTestConfig & {
            projects?: { test?: HostFileTestConfig }[];
          };
        }
      ).test;
      const root = testConfig?.root ?? config.root;
      // Setup files and global-setup files run in the Vitest host (not the
      // emulated runtime), so they may freely import node:* modules. Collect
      // them from the top-level config AND from each `test.projects[i]` —
      // per-project setup files run in the host too and would otherwise be
      // transformed as production code, breaking node:* imports inside them.
      const toAbsolutePaths = (value: string | string[] | undefined, baseRoot: string) =>
        (Array.isArray(value) ? value : value ? [value] : []).map((f) => resolve(baseRoot, f));
      const exemptHostFiles = new Set<string>([
        ...toAbsolutePaths(testConfig?.setupFiles, root),
        ...toAbsolutePaths(testConfig?.globalSetup, root),
      ]);
      // Vitest projects can each define their own `test.include` (and root).
      // A project that uses non-default patterns (e.g. `tests/**/*.spec.ts`)
      // must also be considered when classifying test files — otherwise its
      // tests would be treated as production code and have node:* imports
      // rewritten. Build a list of (root, patterns) pairs covering top-level
      // + every project, and accept a file if any pair matches.
      const includePairs: { root: string; patterns: string[] }[] = [
        { root, patterns: testConfig?.include ?? DEFAULT_TEST_INCLUDE },
      ];
      for (const project of testConfig?.projects ?? []) {
        const projectTest = project?.test;
        if (!projectTest) continue;
        const projectRoot = projectTest.root ?? root;
        for (const f of toAbsolutePaths(projectTest.setupFiles, projectRoot)) {
          exemptHostFiles.add(f);
        }
        for (const f of toAbsolutePaths(projectTest.globalSetup, projectRoot)) {
          exemptHostFiles.add(f);
        }
        includePairs.push({
          root: projectRoot,
          patterns: projectTest.include ?? DEFAULT_TEST_INCLUDE,
        });
      }
      isTestFile = (id: string) => {
        if (exemptHostFiles.has(id)) return true;
        return includePairs.some(({ root: r, patterns }) => {
          const candidate = isAbsolute(id) ? relative(r, id) : id;
          return patterns.some((pattern) => matchesGlob(candidate, pattern));
        });
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
      // Vite can pass ids with query/hash suffixes (e.g. `file.ts?import`,
      // `file.ts?v=hash`). Strip them so exact-path lookups (Set membership,
      // glob matching, absolute-path checks) match what callers configured.
      const queryIdx = id.search(/[?#]/);
      const cleanId = queryIdx === -1 ? id : id.slice(0, queryIdx);

      if (isTestFile(cleanId)) return undefined;
      if (cleanId.includes("node_modules")) return undefined;
      if (!isUserSourceFile(cleanId)) return undefined;

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
          replacements.push({
            start: node.start,
            end: node.end,
            replacement: buildBlockedReplacement(node, getBlockedMessage(specifier)),
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
      let usesTailorRuntime = false;
      if (testConfig?.environment === ENVIRONMENT_NAME) {
        testConfig.environment = environmentPath;
        usesTailorRuntime = true;
      }

      // Rewrite in each project config
      if (testConfig?.projects) {
        for (const project of testConfig.projects) {
          const projectTest = project.test as Record<string, unknown> | undefined;
          if (projectTest?.environment === ENVIRONMENT_NAME) {
            projectTest.environment = environmentPath;
            usesTailorRuntime = true;
          }
        }
      }

      // Pass config path to setup.ts via env var (cross-process compatible).
      // Always clear first, then set only when tailor-runtime is actually
      // selected. This makes the env var deterministic across Vite config
      // reloads (watch mode, programmatic re-init): a stale value from a
      // prior iteration cannot make setup.ts load secrets from an old config.
      // The leading `__` marks this as plugin-private, so deleting any
      // pre-existing value is safe.
      delete process.env.__TAILOR_RUNTIME_CONFIG;
      if (options?.config && usesTailorRuntime) {
        // Resolve against the user-provided Vite root when present (falling
        // back to cwd). Vitest projects with a non-cwd `root` would otherwise
        // resolve a relative options.config against the wrong directory.
        const configRoot = (config.root as string | undefined) ?? process.cwd();
        const configAbsPath = resolve(configRoot, options.config);
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
