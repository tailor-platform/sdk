import {
  bindingIdentifierForCall,
  isExpressionWrapper,
  memberName,
  unwrapExpression,
} from "../lib/ast.js";
import {
  cliImportTracker,
  configureImportTracker,
  isBindingReference,
  variableInitializer,
} from "../lib/sdk-bindings.js";

function isTailorConfigImport(source) {
  return /(?:^|\/)tailor(?:\.[^/]+)?\.config(?:\.[cm]?[jt]sx?)?$/.test(source);
}

function propertyName(property) {
  if (!property.computed && property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return property.key.value;
  return null;
}

function isStartWorkflowAuthInvoker(call, optionObjects) {
  let value = call;
  while (isExpressionWrapper(value.parent)) value = value.parent;
  const property = value.parent;
  if (
    property?.type !== "Property" ||
    property.value !== value ||
    propertyName(property) !== "authInvoker"
  ) {
    return false;
  }
  return optionObjects.has(property.parent);
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
        const startWorkflowOptions = new Set();

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

          if (cliImports.callName(call) === "startWorkflow") {
            let options = unwrapExpression(call.arguments[0]);
            if (options?.type === "Identifier") {
              options = unwrapExpression(variableInitializer(context, options));
            }
            if (options?.type === "ObjectExpression") startWorkflowOptions.add(options);
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
          if (isStartWorkflowAuthInvoker(call, startWorkflowOptions)) continue;
          context.report({ node: callee, messageId: "invoker" });
        }
      },
    };
  },
};
