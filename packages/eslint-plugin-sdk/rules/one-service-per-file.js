import { isModuleLevelCall } from "../lib/ast.js";
import { configureImportTracker } from "../lib/sdk-bindings.js";
import { DEPLOYABLE_SERVICE_FACTORIES } from "../lib/services.js";

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Allow only one deployable Tailor SDK service definition per file.",
    },
    messages: {
      multiple: "Only one deployable service may be defined in a file; found {{count}}.",
    },
    schema: [],
  },
  create(context) {
    const imports = configureImportTracker(context);
    const calls = [];

    return {
      ImportDeclaration: (node) => imports.track(node),
      CallExpression: (node) => calls.push(node),
      "Program:exit"(program) {
        const services = calls.filter(
          (call) =>
            isModuleLevelCall(call) && DEPLOYABLE_SERVICE_FACTORIES.has(imports.callName(call)),
        );
        if (services.length < 2) return;
        context.report({
          node: program,
          messageId: "multiple",
          data: { count: String(services.length) },
        });
      },
    };
  },
};
