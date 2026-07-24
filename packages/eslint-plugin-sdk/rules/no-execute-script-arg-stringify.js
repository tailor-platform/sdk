import { memberName, objectProperty, unwrapExpression } from "../lib/ast.js";
import { cliImportTracker, resolveValue, variableInitializer } from "../lib/sdk-bindings.js";

function isJsonStringifyCall(node) {
  if (node?.type !== "CallExpression") return false;
  const callee = unwrapExpression(node.callee);
  if (memberName(callee) !== "stringify") return false;
  const object = unwrapExpression(callee.object);
  return object?.type === "Identifier" && object.name === "JSON";
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow passing a JSON.stringify(...) result as executeScript's arg option.",
    },
    messages: {
      stringifiedArg:
        "executeScript serializes arg internally; pass the value directly instead of JSON.stringify(...) to avoid double-encoding.",
    },
    schema: [],
  },
  create(context) {
    const imports = cliImportTracker(context);
    const calls = [];

    return {
      ImportDeclaration: (node) => imports.track(node),
      CallExpression: (node) => calls.push(node),
      "Program:exit"() {
        for (const call of calls) {
          if (imports.callName(call) !== "executeScript") continue;
          let options = call.arguments[0];
          if (options?.type === "Identifier") options = variableInitializer(context, options);
          const property = objectProperty(options, "arg");
          if (!property || property.type !== "Property") continue;
          if (!isJsonStringifyCall(resolveValue(context, property.value))) continue;
          context.report({ node: property.value, messageId: "stringifiedArg" });
        }
      },
    };
  },
};
