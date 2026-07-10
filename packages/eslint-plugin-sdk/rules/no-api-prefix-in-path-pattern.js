import { objectProperty, staticString } from "../lib/ast.js";
import { configureImportTracker } from "../lib/sdk-bindings.js";

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow the external /api prefix in HTTP adapter path patterns.",
    },
    messages: {
      prefixed: "pathPattern is matched after the /api prefix; remove the leading /api.",
    },
    schema: [],
  },
  create(context) {
    const imports = configureImportTracker();
    const calls = [];

    return {
      ImportDeclaration: (node) => imports.track(node),
      CallExpression: (node) => calls.push(node),
      "Program:exit"() {
        for (const call of calls) {
          if (imports.callName(call) !== "createHttpAdapter") continue;
          const property = objectProperty(call.arguments[0], "pathPattern");
          if (!property || property.type !== "Property") continue;
          const pattern = staticString(property.value);
          if (pattern !== "/api" && !pattern?.startsWith("/api/")) continue;
          context.report({ node: property.value, messageId: "prefixed" });
        }
      },
    };
  },
};
