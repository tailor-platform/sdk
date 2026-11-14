import {
  callArgument,
  entryKey,
  findImportStatements,
  importBindings,
  localDeclarationNames,
  objectEntries,
  pairValue,
  parseRoot,
} from "./ast-grep-helpers";
import type { Edit, SgNode } from "@ast-grep/napi";

const SDK_MODULE = "@tailor-platform/sdk";
const DEFINE_CONFIG = "defineConfig";
/** Services keyed by namespace, each namespace holding its own `files`. */
const NAMESPACED_SERVICES: ReadonlySet<string> = new Set(["db", "resolver"]);
const SINGLE_SERVICES: ReadonlySet<string> = new Set(["executor", "workflow", "httpAdapter"]);

/** Local names through which a file reaches the SDK's `defineConfig`. */
type DefineConfigBindings = {
  /** Names bound by `import { defineConfig } from "@tailor-platform/sdk"`, aliases included. */
  functions: Set<string>;
  /** Names bound by `import * as sdk from "@tailor-platform/sdk"`. */
  namespaces: Set<string>;
};

/** A `defineConfig()` call whose argument is an object literal. */
type DefineConfigObject = { config: SgNode };

/** Code a transform leaves for a manual migration, with why. */
export type ManualMigration = { reason: string; node: SgNode };

/** A service config object literal that loads files, labelled like `executor` or `db.main`. */
type ServiceConfig = { label: string; node: SgNode };

/** The edits a transform makes to a file, and the code it leaves for a manual migration. */
export type Analysis = { edits: Edit[]; findings: ManualMigration[] };

/** The `defineConfig()` calls of a parsed file. */
export type DefineConfigCalls = {
  /** The parsed file, for committing edits. */
  root: SgNode;
  /** One entry per call to the SDK's `defineConfig`, in source order. */
  calls: Array<DefineConfigObject | ManualMigration>;
};

function namespaceImportName(statement: SgNode): string | null {
  const namespaceImport = statement.find({ rule: { kind: "namespace_import" } });
  const name = namespaceImport?.children().find((child) => child.kind() === "identifier");
  return name?.text() ?? null;
}

function defineConfigBindings(root: SgNode): DefineConfigBindings {
  const bindings: DefineConfigBindings = { functions: new Set(), namespaces: new Set() };
  for (const statement of findImportStatements(root)) {
    const namespaceName = namespaceImportName(statement);
    for (const binding of importBindings(statement)) {
      if (binding.source !== SDK_MODULE || binding.typeOnly) continue;
      if (binding.importedName === DEFINE_CONFIG) bindings.functions.add(binding.localName);
      if (binding.localName === namespaceName) bindings.namespaces.add(binding.localName);
    }
  }
  return bindings;
}

/**
 * The imported name through which `call` reaches the SDK's `defineConfig`,
 * or null when `call` does not call it.
 */
function defineConfigCalleeName(call: SgNode, bindings: DefineConfigBindings): string | null {
  const callee = call.children()[0];
  if (callee?.kind() === "identifier") {
    return bindings.functions.has(callee.text()) ? callee.text() : null;
  }
  if (callee?.kind() !== "member_expression") return null;
  const object = callee.children()[0];
  const property = callee.children().at(-1);
  if (object?.kind() !== "identifier" || property?.text() !== DEFINE_CONFIG) return null;
  return bindings.namespaces.has(object.text()) ? object.text() : null;
}

/**
 * Find the calls to `defineConfig` imported from `@tailor-platform/sdk`.
 * @param source - File contents
 * @param filePath - Path to the file, which selects the parser
 * @returns The parsed file and its calls, or null when the file never calls the SDK's defineConfig
 */
export function findDefineConfigCalls(source: string, filePath: string): DefineConfigCalls | null {
  if (!source.includes(DEFINE_CONFIG)) return null;
  const root = parseRoot(source, filePath);
  if (!root) return null;
  const bindings = defineConfigBindings(root);
  if (bindings.functions.size === 0 && bindings.namespaces.size === 0) return null;
  const declaredNames = localDeclarationNames(root);

  const calls: DefineConfigCalls["calls"] = [];
  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    const calleeName = defineConfigCalleeName(call, bindings);
    if (!calleeName) continue;
    if (declaredNames.has(calleeName)) {
      calls.push({
        reason: `\`${calleeName}\` is declared again in this file, so this call may not be the SDK's defineConfig()`,
        node: call,
      });
      continue;
    }
    const config = callArgument(call);
    if (!config) continue;
    if (config.kind() !== "object") {
      calls.push({ reason: "the defineConfig() argument is not an object literal", node: call });
      continue;
    }
    calls.push({ config });
  }
  return { root, calls };
}

function objectValue(entry: SgNode): SgNode | null {
  const value = entry.kind() === "pair" ? pairValue(entry) : null;
  return value?.kind() === "object" ? value : null;
}

/**
 * The service configs of a `defineConfig()` argument that load files through
 * `files`: each `db` and `resolver` namespace, `executor`, `workflow`, and
 * `httpAdapter`.
 * @param config - The object literal passed to `defineConfig()`
 * @returns Each service config in source order, or why one cannot be read from the source
 */
function serviceConfigs(config: SgNode): Array<ServiceConfig | ManualMigration> {
  const services: Array<ServiceConfig | ManualMigration> = [];
  const entries = objectEntries(config);
  if (entries.some((entry) => entryKey(entry) === null)) {
    services.push({
      reason: "the config has a spread or computed key that may hold service files",
      node: config,
    });
  }
  for (const entry of entries) {
    const key = entryKey(entry);
    if (key === null || (!NAMESPACED_SERVICES.has(key) && !SINGLE_SERVICES.has(key))) continue;
    const value = objectValue(entry);
    if (!value) {
      services.push({ reason: `\`${key}\` is not an object literal`, node: entry });
      continue;
    }
    if (SINGLE_SERVICES.has(key)) {
      services.push({ label: key, node: value });
      continue;
    }
    for (const namespaceEntry of objectEntries(value)) {
      const namespace = entryKey(namespaceEntry);
      const namespaceConfig = namespace === null ? null : objectValue(namespaceEntry);
      if (namespace === null || !namespaceConfig) {
        services.push({
          reason: `a \`${key}\` namespace is not written as an object literal`,
          node: namespaceEntry,
        });
        continue;
      }
      services.push({ label: `${key}.${namespace}`, node: namespaceConfig });
    }
  }
  return services;
}

/**
 * Analyze every service config of `calls` that loads files, keeping the calls
 * and services that cannot be read from the source as findings.
 * @param calls - The `defineConfig()` calls of a file
 * @param analyze - Analysis of one service config, given its label and object literal
 * @returns The edits and findings of all service configs, in source order
 */
export function analyzeServiceConfigs(
  calls: DefineConfigCalls["calls"],
  analyze: (label: string, service: SgNode) => Analysis,
): Analysis {
  const analysis: Analysis = { edits: [], findings: [] };
  for (const call of calls) {
    if ("reason" in call) {
      analysis.findings.push(call);
      continue;
    }
    for (const service of serviceConfigs(call.config)) {
      if ("reason" in service) {
        analysis.findings.push(service);
        continue;
      }
      const result = analyze(service.label, service.node);
      analysis.edits.push(...result.edits);
      analysis.findings.push(...result.findings);
    }
  }
  return analysis;
}
