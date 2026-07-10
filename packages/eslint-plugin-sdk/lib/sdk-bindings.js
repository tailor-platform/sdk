import { memberName, nodeStart, unwrapExpression } from "./ast.js";

export const SDK_CONFIGURE_MODULE = "@tailor-platform/sdk";
export const SDK_CLI_MODULE = "@tailor-platform/sdk/cli";
export const SDK_RUNTIME_MODULE = "@tailor-platform/sdk/runtime";
export const SDK_WORKFLOW_RUNTIME_MODULE = "@tailor-platform/sdk/runtime/workflow";

function findVariable(sourceCode, node) {
  let scope = sourceCode.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

export function isBindingReference(context, node, binding) {
  if (node?.type !== "Identifier") return false;
  const variable = findVariable(context.sourceCode, node);
  return (
    variable?.identifiers.some((identifier) => nodeStart(identifier) === nodeStart(binding)) ??
    false
  );
}

export function variableInitializer(context, node) {
  if (node?.type !== "Identifier") return null;
  const variable = findVariable(context.sourceCode, node);
  const definition = variable?.defs.find(
    (entry) => entry.type === "Variable" && entry.node?.type === "VariableDeclarator",
  );
  return definition?.node.init ?? null;
}

export function createImportTracker(context, modules) {
  const named = new Map();
  const namespaces = new Map();

  return {
    track(node) {
      if (!modules.has(node.source.value)) return;
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") {
          namespaces.set(specifier.local.name, specifier.local);
          continue;
        }
        if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
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
      if (object?.type !== "Identifier" || !this.isNamespace(object)) return null;
      return memberName(callee);
    },

    importedAs(node, importedName) {
      if (node?.type !== "Identifier") return false;
      const entry = named.get(node.name);
      return entry?.imported === importedName && isBindingReference(context, node, entry.binding);
    },

    isNamespace(node) {
      if (node?.type !== "Identifier") return false;
      const binding = namespaces.get(node.name);
      return binding !== undefined && isBindingReference(context, node, binding);
    },
  };
}

export function configureImportTracker(context) {
  return createImportTracker(context, new Set([SDK_CONFIGURE_MODULE]));
}

export function cliImportTracker(context) {
  return createImportTracker(context, new Set([SDK_CLI_MODULE]));
}

export function workflowRuntimeImportTracker(context) {
  return createImportTracker(context, new Set([SDK_RUNTIME_MODULE, SDK_WORKFLOW_RUNTIME_MODULE]));
}
