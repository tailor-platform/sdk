import { type AstCallExpression, type AstNode, memberName, unwrapExpression } from "../lib/ast.js";
import { configureImportTracker, resolveValue } from "../lib/sdk-bindings.js";
import { hasAncestor, workflowJobDefinition } from "../lib/workflow.js";
import type { Rule } from "eslint";

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow calling a workflow job's .start() outside the body of the workflow job that starts it.",
    },
    messages: {
      startOutsideBody:
        "{{job}}.start() is not inside any workflow job's body; dependency detection only sees .start() calls lexically inside a body, so move the call (or the function containing it) into the calling job's body.",
    },
    schema: [],
  },
  create(context) {
    const imports = configureImportTracker(context);
    const calls: AstCallExpression[] = [];

    return {
      ImportDeclaration: (node) => imports.track(node),
      CallExpression: (node) => calls.push(node),
      "Program:exit"() {
        const bodies = new Set<AstNode>();
        for (const call of calls) {
          const body = workflowJobDefinition(imports, call)?.body;
          if (body) bodies.add(body.value);
        }
        for (const call of calls) {
          const callee = unwrapExpression(call.callee);
          if (callee?.type !== "MemberExpression" && callee?.type !== "OptionalMemberExpression") {
            continue;
          }
          if (memberName(callee) !== "start") continue;
          const job = unwrapExpression(callee.object);
          if (job?.type !== "Identifier") continue;
          const target = resolveValue(context, job);
          if (
            target?.type !== "CallExpression" ||
            workflowJobDefinition(imports, target) === null
          ) {
            continue;
          }
          if (hasAncestor(call, bodies)) continue;
          context.report({ node: call, messageId: "startOutsideBody", data: { job: job.name } });
        }
      },
    };
  },
} satisfies Rule.RuleModule;

export default rule;
