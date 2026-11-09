import {
  callArgument,
  findImportStatements,
  importBindings,
  localDeclarationNames,
  parseRoot,
} from "./ast-grep-helpers";
import type { SgNode } from "@ast-grep/napi";

const SDK_MODULE = "@tailor-platform/sdk";
const DEFINE_CONFIG = "defineConfig";

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
