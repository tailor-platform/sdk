import { bindingIdentifierForCall, memberName, unwrapExpression } from "../lib/ast.js";
import {
  cliImportTracker,
  configureImportTracker,
  isBindingReference,
} from "../lib/sdk-bindings.js";

function isTailorConfigImport(source) {
  return /(?:^|\/)tailor(?:\.[^/]+)?\.config(?:\.[cm]?[jt]sx?)?$/.test(source);
}

function propertyName(property) {
  if (!property.computed && property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return property.key.value;
  return null;
}

function isStartWorkflowAuthInvoker(call, imports) {
  const property = call.parent;
  if (
    property?.type !== "Property" ||
    property.value !== call ||
    propertyName(property) !== "authInvoker"
  ) {
    return false;
  }
  const options = property.parent;
  const startCall = options?.parent;
  return (
    options?.type === "ObjectExpression" &&
    startCall?.type === "CallExpression" &&
    startCall.arguments.includes(options) &&
    imports.callName(startCall) === "startWorkflow"
  );
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
    const imports = configureImportTracker(context);
    const cliImports = cliImportTracker(context);
    const authBindings = [];
    const configBindings = [];
    const calls = [];

    return {
      ImportDeclaration(node) {
        imports.track(node);
        cliImports.track(node);
        if (!isTailorConfigImport(String(node.source.value))) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportDefaultSpecifier") {
            configBindings.push(specifier.local);
          } else if (
            specifier.type === "ImportSpecifier" &&
            specifier.importKind !== "type" &&
            (specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : specifier.imported.value) === "auth"
          ) {
            authBindings.push(specifier.local);
          }
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
            const binding = bindingIdentifierForCall(call);
            if (binding) authBindings.push(binding);
          }
        }

        for (const call of calls) {
          const callee = unwrapExpression(call.callee);
          if (memberName(callee) !== "invoker") continue;
          const object = unwrapExpression(callee.object);
          const isAuth =
            object?.type === "Identifier" &&
            authBindings.some((binding) => isBindingReference(context, object, binding));
          const config = unwrapExpression(object?.object);
          const isConfigAuth =
            memberName(object) === "auth" &&
            config?.type === "Identifier" &&
            configBindings.some((binding) => isBindingReference(context, config, binding));
          if (!isAuth && !isConfigAuth) continue;
          if (isStartWorkflowAuthInvoker(call, cliImports)) continue;
          context.report({ node: callee, messageId: "invoker" });
        }
      },
    };
  },
};
