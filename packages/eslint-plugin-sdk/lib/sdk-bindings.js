import { memberName, unwrapExpression } from "./ast.js";

export const SDK_CONFIGURE_MODULE = "@tailor-platform/sdk";
export const SDK_RUNTIME_MODULE = "@tailor-platform/sdk/runtime";
export const SDK_WORKFLOW_RUNTIME_MODULE = "@tailor-platform/sdk/runtime/workflow";

export function createImportTracker(modules) {
  const named = new Map();
  const namespaces = new Set();

  return {
    track(node) {
      if (!modules.has(node.source.value)) return;
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") {
          namespaces.add(specifier.local.name);
          continue;
        }
        if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
        const imported =
          specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : String(specifier.imported.value);
        named.set(specifier.local.name, imported);
      }
    },

    callName(call) {
      const callee = unwrapExpression(call.callee);
      if (callee?.type === "Identifier") {
        return named.get(callee.name) ?? null;
      }
      if (callee?.type !== "MemberExpression" && callee?.type !== "OptionalMemberExpression") {
        return null;
      }
      const object = unwrapExpression(callee.object);
      if (object?.type !== "Identifier" || !namespaces.has(object.name)) return null;
      return memberName(callee);
    },

    importedAs(localName, importedName) {
      return named.get(localName) === importedName;
    },

    isNamespace(localName) {
      return namespaces.has(localName);
    },
  };
}

export function configureImportTracker() {
  return createImportTracker(new Set([SDK_CONFIGURE_MODULE]));
}

export function workflowRuntimeImportTracker() {
  return createImportTracker(new Set([SDK_RUNTIME_MODULE, SDK_WORKFLOW_RUNTIME_MODULE]));
}
