import { directStatementList, memberName, nodeStart, unwrapExpression } from "../lib/ast.js";
import { workflowRuntimeImportTracker } from "../lib/sdk-bindings.js";

function expressionKey(sourceCode, expression) {
  return sourceCode
    .getTokens(unwrapExpression(expression))
    .map((token) => `${token.type}:${token.value.length}:${token.value}`)
    .join("|");
}

function memberObjectIdentifier(callee) {
  if (callee?.type !== "MemberExpression" && callee?.type !== "OptionalMemberExpression") {
    return null;
  }
  const object = unwrapExpression(callee.object);
  return object?.type === "Identifier" ? object : null;
}

function isCallback(node) {
  const callback = unwrapExpression(node);
  return (
    callback?.type === "ArrowFunctionExpression" ||
    callback?.type === "FunctionExpression" ||
    callback?.type === "Identifier" ||
    callback?.type === "MemberExpression" ||
    callback?.type === "OptionalMemberExpression"
  );
}

function isWorkflowFacadeCall(callee, imports, name) {
  if (memberName(callee) !== name) return false;
  const workflow = unwrapExpression(callee.object);
  if (workflow?.type === "Identifier" && imports.importedAs(workflow, "workflow")) return true;
  if (memberName(workflow) !== "workflow") return false;
  return imports.isNamespace(unwrapExpression(workflow.object));
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
    const imports = workflowRuntimeImportTracker(context);
    const calls = [];

    return {
      ImportDeclaration: (node) => imports.track(node),
      CallExpression: (node) => calls.push(node),
      "Program:exit"() {
        const resolves = [];

        for (const call of calls) {
          const callee = unwrapExpression(call.callee);
          const directName = imports.callName(call);
          const isRuntimeResolve =
            (directName === "resolve" || isWorkflowFacadeCall(callee, imports, "resolve")) &&
            call.arguments.length >= 3 &&
            isCallback(call.arguments[2]);
          const isWaitPointResolve =
            directName === null &&
            memberName(callee) === "resolve" &&
            call.arguments.length >= 2 &&
            isCallback(call.arguments[1]);
          if (!isRuntimeResolve && !isWaitPointResolve) continue;
          resolves.push({
            block: directStatementList(call),
            execution: expressionKey(context.sourceCode, call.arguments[0]),
            position: nodeStart(call),
          });
        }

        for (const call of calls) {
          const callee = unwrapExpression(call.callee);
          const directResume = imports.callName(call) === "resumeWorkflow";
          const object = memberObjectIdentifier(callee);
          const memberResume =
            memberName(callee) === "resumeWorkflow" &&
            object !== null &&
            (imports.isNamespace(object) || imports.importedAs(object, "workflow"));
          if (
            (!directResume &&
              !memberResume &&
              !isWorkflowFacadeCall(callee, imports, "resumeWorkflow")) ||
            call.arguments.length === 0
          ) {
            continue;
          }

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
