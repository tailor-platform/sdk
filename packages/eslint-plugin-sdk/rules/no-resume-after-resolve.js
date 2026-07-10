import { directStatementList, memberName, nodeStart, unwrapExpression } from "../lib/ast.js";
import { workflowRuntimeImportTracker } from "../lib/sdk-bindings.js";

function expressionKey(sourceCode, expression) {
  return sourceCode.getText(expression).replaceAll(/\s+/g, "");
}

function memberObjectIdentifier(callee) {
  if (callee?.type !== "MemberExpression" && callee?.type !== "OptionalMemberExpression") {
    return null;
  }
  const object = unwrapExpression(callee.object);
  return object?.type === "Identifier" ? object.name : null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow resuming a workflow after resolving its wait point.",
    },
    messages: {
      redundant:
        "resolve() already resumes the waiting workflow; do not call resumeWorkflow() for the same execution.",
    },
    schema: [],
  },
  create(context) {
    const imports = workflowRuntimeImportTracker();
    const calls = [];

    return {
      ImportDeclaration: (node) => imports.track(node),
      CallExpression: (node) => calls.push(node),
      "Program:exit"() {
        const resolves = [];

        for (const call of calls) {
          const callee = unwrapExpression(call.callee);
          const directName = imports.callName(call);
          const name = directName ?? memberName(callee);
          if (name !== "resolve" || call.arguments.length < 2) continue;
          resolves.push({
            block: directStatementList(call),
            execution: expressionKey(context.sourceCode, call.arguments[0]),
            position: nodeStart(call),
          });
        }

        for (const call of calls) {
          const callee = unwrapExpression(call.callee);
          const directResume = imports.callName(call) === "resumeWorkflow";
          const objectName = memberObjectIdentifier(callee);
          const memberResume =
            memberName(callee) === "resumeWorkflow" &&
            objectName !== null &&
            (imports.isNamespace(objectName) || imports.importedAs(objectName, "workflow"));
          if ((!directResume && !memberResume) || call.arguments.length === 0) continue;

          const block = directStatementList(call);
          if (block === null) continue;
          const execution = expressionKey(context.sourceCode, call.arguments[0]);
          const position = nodeStart(call);
          const resolvedEarlier = resolves.some(
            (resolve) =>
              resolve.block === block &&
              resolve.block !== null &&
              resolve.execution === execution &&
              resolve.position < position,
          );
          if (resolvedEarlier) {
            context.report({ node: call, messageId: "redundant" });
          }
        }
      },
    };
  },
};
