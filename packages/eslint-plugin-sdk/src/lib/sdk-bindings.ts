import {
  type AstCallExpression,
  type AstIdentifier,
  type AstImportDeclaration,
  type AstNode,
  memberName,
  nodeStart,
  unwrapExpression,
} from "./ast.js";
import type { Rule, Scope, SourceCode } from "eslint";

export const SDK_CONFIGURE_MODULE = "@tailor-platform/sdk";
const SDK_CLI_MODULE = "@tailor-platform/sdk/cli";

interface ImportBinding {
  binding: AstIdentifier;
  imported: string;
}

export interface ImportTracker {
  track(node: AstImportDeclaration): void;
  callName(call: AstCallExpression): string | null;
  importedAs(node: AstNode | null | undefined, importedName: string): boolean;
  importedNames(): ReadonlyMap<string, string>;
  isNamespace(node: AstNode | null | undefined): boolean;
}

function findVariable(sourceCode: SourceCode, node: AstIdentifier): Scope.Variable | null {
  let scope: Scope.Scope | null = sourceCode.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

function isBindingReference(
  context: Rule.RuleContext,
  node: AstNode | null | undefined,
  binding: AstIdentifier,
): boolean {
  if (node?.type !== "Identifier") return false;
  const variable = findVariable(context.sourceCode, node);
  return (
    variable?.identifiers.some((identifier) => nodeStart(identifier) === nodeStart(binding)) ??
    false
  );
}

function variableInitializer(
  context: Rule.RuleContext,
  node: AstNode | null | undefined,
): AstNode | null {
  if (node?.type !== "Identifier") return null;
  const variable = findVariable(context.sourceCode, node);
  const definition = variable?.defs.find(
    (entry) => entry.type === "Variable" && entry.parent.kind === "const",
  );
  return definition?.type === "Variable" ? (definition.node.init ?? null) : null;
}

export function resolveValue(
  context: Rule.RuleContext,
  node: AstNode | null | undefined,
): AstNode | null | undefined {
  let current = unwrapExpression(node);
  const seen = new Set<string>();
  while (current?.type === "Identifier" && !seen.has(current.name)) {
    seen.add(current.name);
    const initializer = variableInitializer(context, current);
    if (initializer === null) break;
    current = unwrapExpression(initializer);
  }
  return current;
}

function createImportTracker(
  context: Rule.RuleContext,
  modules: ReadonlySet<string>,
): ImportTracker {
  const named = new Map<string, ImportBinding>();
  const namespaces = new Map<string, AstIdentifier>();

  const isNamespace = (node: AstNode | null | undefined): boolean => {
    if (node?.type !== "Identifier") return false;
    const binding = namespaces.get(node.name);
    return binding !== undefined && isBindingReference(context, node, binding);
  };

  return {
    track(node) {
      if (typeof node.source.value !== "string" || !modules.has(node.source.value)) return;
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") {
          namespaces.set(specifier.local.name, specifier.local);
          continue;
        }
        if (
          specifier.type !== "ImportSpecifier" ||
          ("importKind" in specifier && specifier.importKind === "type")
        ) {
          continue;
        }
        const imported =
          specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : String(specifier.imported.value);
        named.set(specifier.local.name, { binding: specifier.local, imported });
      }
    },

    callName(call) {
      const callee = unwrapExpression(call.callee);
      if (callee?.type === "Identifier") {
        const entry = named.get(callee.name);
        return entry && isBindingReference(context, callee, entry.binding) ? entry.imported : null;
      }
      if (callee?.type !== "MemberExpression" && callee?.type !== "OptionalMemberExpression") {
        return null;
      }
      const object = unwrapExpression(callee.object);
      if (object?.type !== "Identifier" || !isNamespace(object)) return null;
      return memberName(callee);
    },

    importedAs(node, importedName) {
      if (node?.type !== "Identifier") return false;
      const entry = named.get(node.name);
      return entry?.imported === importedName && isBindingReference(context, node, entry.binding);
    },

    importedNames() {
      return new Map(Array.from(named, ([local, entry]) => [local, entry.imported]));
    },

    isNamespace,
  };
}

export function configureImportTracker(context: Rule.RuleContext): ImportTracker {
  return createImportTracker(context, new Set([SDK_CONFIGURE_MODULE]));
}

export function cliImportTracker(context: Rule.RuleContext): ImportTracker {
  return createImportTracker(context, new Set([SDK_CLI_MODULE]));
}
