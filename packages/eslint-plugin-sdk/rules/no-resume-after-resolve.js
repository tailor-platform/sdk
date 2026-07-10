import { directStatementList, memberName, nodeStart, unwrapExpression } from "../lib/ast.js";
import { isBindingReassigned, workflowRuntimeImportTracker } from "../lib/sdk-bindings.js";

function isStableExpression(context, expression) {
  const value = unwrapExpression(expression);
  if (!value) return false;
  if (value.type === "Identifier") return !isBindingReassigned(context, value);
  if (value.type === "Literal" || value.type === "ThisExpression") return true;
  if (value.type === "MemberExpression" || value.type === "OptionalMemberExpression") {
    return (
      isStableExpression(context, value.object) &&
      (!value.computed || isStableExpression(context, value.property))
    );
  }
  if (value.type === "BinaryExpression" || value.type === "LogicalExpression") {
    return isStableExpression(context, value.left) && isStableExpression(context, value.right);
  }
  if (value.type === "UnaryExpression") return isStableExpression(context, value.argument);
  if (value.type === "ConditionalExpression") {
    return (
      isStableExpression(context, value.test) &&
      isStableExpression(context, value.consequent) &&
      isStableExpression(context, value.alternate)
    );
  }
  if (value.type === "TemplateLiteral") {
    return value.expressions.every((entry) => isStableExpression(context, entry));
  }
  return false;
}

function expressionKey(context, expression) {
  const value = unwrapExpression(expression);
  if (!isStableExpression(context, value)) return null;
  return context.sourceCode
    .getTokens(value)
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
          const execution = expressionKey(context, call.arguments[0]);
          if (execution === null) continue;
          resolves.push({
            block: directStatementList(call),
            execution,
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
          const execution = expressionKey(context, call.arguments[0]);
          if (execution === null) continue;
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
