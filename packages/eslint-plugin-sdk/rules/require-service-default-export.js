import { isModuleLevelCall } from "../lib/ast.js";
import { collectExports, exportStatus } from "../lib/exports.js";
import { configureImportTracker } from "../lib/sdk-bindings.js";

const SERVICES = new Map([
  ["createResolver", "resolver"],
  ["createExecutor", "executor"],
  ["createHttpAdapter", "HTTP adapter"],
  ["createWorkflow", "workflow"],
]);

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require deployable Tailor SDK services to be default exports.",
    },
    messages: {
      required: "The {{service}} created by {{factory}}() must be the default export.",
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
        const exports = collectExports(program);
        for (const call of calls) {
          if (!isModuleLevelCall(call)) continue;
          const factory = imports.callName(call);
          const service = factory === null ? null : SERVICES.get(factory);
          if (!service || exportStatus(call, exports, context).isDefault) continue;
          context.report({
            node: call,
            messageId: "required",
            data: { factory, service },
          });
        }
      },
    };
  },
};
