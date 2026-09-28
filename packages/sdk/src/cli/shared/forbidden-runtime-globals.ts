import * as path from "pathe";
import { findUndefinedReferences } from "#/cli/shared/free-variables";
import { getForbiddenGlobalMessage, isForbiddenGlobal } from "#/utils/node-builtins";
import { CLIError } from "./errors";
import type { AllowedRuntimeGlobals } from "#/configure/config/types";

/** The parts of a bundled output chunk the forbidden-global check reads. */
export interface BundledChunk {
  /** The chunk's final bundled code. */
  code: string;
  /** Each bundled module's own rendered code, keyed by module id. */
  modules: Readonly<Record<string, { readonly code: string | null }>>;
}

/** Forbidden globals referenced by each installed package, keyed by package name. */
export type PackageRuntimeGlobals = Record<string, string[]>;

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

/**
 * Check bundled output for Node-only globals (`process`, `Buffer`, etc.) that
 * the Tailor Platform runtime never defines. A reference from the project's
 * own code throws a CLIError naming the file; a reference only from an
 * installed package (a module under `node_modules`) is returned instead, for
 * `assertPackageRuntimeGlobalsAllowed` to check against `allowedRuntimeGlobals`,
 * since the project cannot change that code. Run this against already-bundled output, not source text — bundling
 * resolves every reachable import first, so any free variable left over is
 * either a genuine runtime global or unreachable dead code the bundler failed
 * to resolve (which `bundleLog.assertAllResolved()` already catches).
 * @param chunk - Bundled output chunk to scan.
 * @param context - Human-readable description of what produced `chunk`, used in the error message.
 * @returns The forbidden globals each installed package references.
 */
export function checkForbiddenRuntimeGlobals(
  chunk: BundledChunk,
  context: string,
): PackageRuntimeGlobals {
  const forbidden = new Set([...findUndefinedReferences(chunk.code)].filter(isForbiddenGlobal));
  if (forbidden.size === 0) return {};

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

  if (filesByUserGlobal.size > 0) {
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

  return Object.fromEntries(
    [...globalsByPackage].map(([packageName, names]) => [packageName, [...names].toSorted()]),
  );
}

/**
 * Throw a CLIError when an installed package references a forbidden global
 * that `allowedRuntimeGlobals` does not allow for it.
 * @param packageRuntimeGlobals - The forbidden globals each installed package references.
 * @param context - Human-readable description of the bundle, used in the error message.
 * @param allowedRuntimeGlobals - Globals each installed package may reference.
 */
export function assertPackageRuntimeGlobalsAllowed(
  packageRuntimeGlobals: PackageRuntimeGlobals,
  context: string,
  allowedRuntimeGlobals: AllowedRuntimeGlobals = {},
): void {
  const rejected: PackageRuntimeGlobals = {};
  for (const [packageName, names] of Object.entries(packageRuntimeGlobals)) {
    const allowed = Object.hasOwn(allowedRuntimeGlobals, packageName)
      ? allowedRuntimeGlobals[packageName]
      : undefined;
    if (allowed === true) continue;
    const notAllowed = names.filter((name) => !allowed?.includes(name));
    if (notAllowed.length > 0) rejected[packageName] = notAllowed;
  }

  const entries = Object.entries(rejected);
  if (entries.length === 0) return;
  const globals = [...new Set(entries.flatMap(([, names]) => names))].toSorted();
  throw CLIError({
    code: "FORBIDDEN_RUNTIME_GLOBAL",
    message: `${context} references ${describeGlobals(globals)}.`,
    details: entries
      .map(
        ([packageName, names]) =>
          `Referenced from the installed package ${packageName}: ${names.join(", ")}. ` +
          `Code in ${packageName} that reaches ${names.length === 1 ? "it" : "them"} throws a ReferenceError at runtime.`,
      )
      .join("\n"),
    suggestion:
      "If that code never runs for your use of the package, allow it in defineConfig(): " +
      `allowedRuntimeGlobals: { ${entries.map(([packageName, names]) => `${JSON.stringify(packageName)}: ${JSON.stringify(names)}`).join(", ")} }`,
    context: { packages: rejected },
  });
}
