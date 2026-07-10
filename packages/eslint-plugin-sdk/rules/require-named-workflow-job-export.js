import { collectExports, exportStatus } from "../lib/exports.js";
import { configureImportTracker } from "../lib/sdk-bindings.js";

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require Tailor workflow jobs to be named exports.",
    },
    messages: {
      required: "The job created by createWorkflowJob() must be a named export.",
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
          if (imports.callName(call) !== "createWorkflowJob") continue;
          const status = exportStatus(call, exports);
          if (status.isNamed && !status.isDefault) continue;
          context.report({ node: call, messageId: "required" });
        }
      },
    };
  },
};
