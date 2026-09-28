import * as path from "pathe";
import { findUndefinedReferences } from "#/cli/shared/free-variables";
import { getForbiddenGlobalMessage, isForbiddenGlobal } from "#/utils/node-builtins";
import { CLIError } from "./errors";
import { logger } from "./logger";
import type { AllowedRuntimeGlobals } from "#/configure/config/types";

/** The parts of a bundled output chunk the forbidden-global check reads. */
export interface BundledChunk {
  /** The chunk's final bundled code. */
  code: string;
  /** Each bundled module's own rendered code, keyed by module id. */
  modules: Readonly<Record<string, { readonly code: string | null }>>;
}

const NODE_MODULES_SEGMENT = "/node_modules/";

function packageNameOf(moduleId: string): string | undefined {
  const normalizedId = path.normalize(moduleId);
  const index = normalizedId.lastIndexOf(NODE_MODULES_SEGMENT);
  if (index === -1) return undefined;
  const [scopeOrName, name] = normalizedId.slice(index + NODE_MODULES_SEGMENT.length).split("/");
  return scopeOrName?.startsWith("@") ? `${scopeOrName}/${name}` : scopeOrName;
}

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const values = map.get(key) ?? new Set<V>();
  values.add(value);
  map.set(key, values);
}

const describeGlobals = (names: string[]) =>
  `${names.length === 1 ? "a global" : "globals"} unavailable in the Tailor Platform runtime: ${names.join(", ")}`;

const warnedPackageGlobals = new Set<string>();

function warnPackageGlobals(packageName: string, names: string[], context: string): void {
  const key = `${packageName}\0${names.join(",")}`;
  if (warnedPackageGlobals.has(key)) return;
  warnedPackageGlobals.add(key);
  logger.warn(
    `${packageName} (bundled into ${context}) references ${describeGlobals(names)}. ` +
      `Code in ${packageName} that reaches ${names.length === 1 ? "it" : "them"} throws a ReferenceError at runtime. ` +
      `If that code never runs, add ${JSON.stringify(packageName)}: ${JSON.stringify(names)} to allowedRuntimeGlobals in defineConfig() to silence this warning.`,
  );
}

/**
 * Check bundled output for Node-only globals (`process`, `Buffer`, etc.) that
 * the Tailor Platform runtime never defines. A reference from the project's
 * own code throws a CLIError naming the file; a reference only from an
 * installed package (a module under `node_modules`) is reported as a warning,
 * since the project cannot change that code. Run this against already-bundled
 * output, not source text — bundling resolves every reachable import first,
 * so any free variable left over is either a genuine runtime global or
 * unreachable dead code the bundler failed to resolve (which
 * `bundleLog.assertAllResolved()` already catches).
 * @param chunk - Bundled output chunk to scan.
 * @param context - Human-readable description of what produced `chunk`, used in the messages.
 * @param allowedRuntimeGlobals - Globals each installed package may reference without a warning.
 */
export function assertNoForbiddenRuntimeGlobals(
  chunk: BundledChunk,
  context: string,
  allowedRuntimeGlobals: AllowedRuntimeGlobals = {},
): void {
  const forbidden = new Set([...findUndefinedReferences(chunk.code)].filter(isForbiddenGlobal));
  if (forbidden.size === 0) return;

  const filesByUserGlobal = new Map<string, Set<string>>();
  const globalsByPackage = new Map<string, Set<string>>();
  const attributed = new Set<string>();
  for (const [moduleId, { code }] of Object.entries(chunk.modules)) {
    if (!code) continue;
    const packageName = packageNameOf(moduleId);
    for (const name of findUndefinedReferences(code)) {
      if (!forbidden.has(name)) continue;
      attributed.add(name);
      if (packageName) {
        addTo(globalsByPackage, packageName, name);
      } else {
        addTo(filesByUserGlobal, name, path.relative(process.cwd(), moduleId));
      }
    }
  }
  for (const name of forbidden) {
    if (!attributed.has(name)) filesByUserGlobal.set(name, new Set());
  }

  for (const [packageName, names] of globalsByPackage) {
    const allowed = Object.hasOwn(allowedRuntimeGlobals, packageName)
      ? allowedRuntimeGlobals[packageName]
      : undefined;
    if (allowed === true) continue;
    const warned = [...names].filter((name) => !allowed?.includes(name)).toSorted();
    if (warned.length > 0) warnPackageGlobals(packageName, warned, context);
  }

  if (filesByUserGlobal.size === 0) return;
  const userGlobals = [...filesByUserGlobal.keys()].toSorted();
  throw CLIError({
    code: "FORBIDDEN_RUNTIME_GLOBAL",
    message: `${context} references ${describeGlobals(userGlobals)}.`,
    details: userGlobals
      .map((name) => {
        const files = [...(filesByUserGlobal.get(name) ?? [])].toSorted();
        const message = getForbiddenGlobalMessage(name);
        return files.length > 0 ? `${message}\nReferenced from: ${files.join(", ")}` : message;
      })
      .join("\n"),
  });
}
