import { bindingNameForCall, memberName, unwrapExpression } from "../lib/ast.js";
import { configureImportTracker } from "../lib/sdk-bindings.js";

function isTailorConfigImport(source) {
  return /(?:^|\/)tailor(?:\.[^/]+)?\.config(?:\.[cm]?[jt]sx?)?$/.test(source);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow deprecated Tailor SDK configuration APIs.",
    },
    messages: {
      generators: "defineGenerators() is deprecated; use definePlugins() instead.",
      invoker: "auth.invoker() is deprecated; pass the machine-user name as a string.",
    },
    schema: [],
  },
  create(context) {
    const imports = configureImportTracker();
    const authBindings = new Set();
    const calls = [];

    return {
      ImportDeclaration(node) {
        imports.track(node);
        if (!isTailorConfigImport(String(node.source.value))) return;
        for (const specifier of node.specifiers) {
          if (specifier.importKind !== "type") authBindings.add(specifier.local.name);
        }
      },
      CallExpression: (node) => calls.push(node),
      "Program:exit"() {
        for (const call of calls) {
          const sdkCall = imports.callName(call);
          if (sdkCall === "defineGenerators") {
            context.report({ node: call, messageId: "generators" });
            continue;
          }
          if (sdkCall === "defineAuth") {
            const binding = bindingNameForCall(call);
            if (binding) authBindings.add(binding);
          }
        }

        for (const call of calls) {
          const callee = unwrapExpression(call.callee);
          if (memberName(callee) !== "invoker") continue;
          const object = unwrapExpression(callee.object);
          if (object?.type !== "Identifier" || !authBindings.has(object.name)) continue;
          context.report({ node: callee, messageId: "invoker" });
        }
      },
    };
  },
};
