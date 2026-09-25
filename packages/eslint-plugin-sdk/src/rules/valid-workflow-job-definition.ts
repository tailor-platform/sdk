import { type AstCallExpression, type AstNode } from "../lib/ast.js";
import { configureImportTracker } from "../lib/sdk-bindings.js";
import { workflowJobDefinition } from "../lib/workflow.js";
import type { Rule } from "eslint";

function isStringLiteral(node: AstNode | null | undefined): boolean {
  return node?.type === "Literal" && typeof node.value === "string";
}

function isFunctionExpression(node: AstNode | null | undefined): boolean {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require createWorkflowJob definitions the build can detect statically: an inline options object with a string literal name and an inline function body.",
    },
    messages: {
      optionsNotLiteral:
        "createWorkflowJob's options must be an inline object literal; the build cannot detect a job whose options come from a variable or call.",
      nameNotLiteral:
        'createWorkflowJob\'s "name" must be a string literal; the build cannot detect a job whose name is a variable, template literal, or computed value.',
      bodyNotFunction:
        'createWorkflowJob\'s "body" must be an inline function expression; the build cannot bundle a body that is a variable or wrapped in another call.',
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
        for (const call of calls) {
          const job = workflowJobDefinition(imports, call);
          if (job === null) continue;
          if (job.options?.type !== "ObjectExpression") {
            context.report({ node: job.options ?? call, messageId: "optionsNotLiteral" });
            continue;
          }
          if (!isStringLiteral(job.name?.value)) {
            context.report({ node: job.name?.value ?? job.options, messageId: "nameNotLiteral" });
          }
          if (!isFunctionExpression(job.body?.value)) {
            context.report({ node: job.body?.value ?? job.options, messageId: "bodyNotFunction" });
          }
        }
      },
    };
  },
} satisfies Rule.RuleModule;

export default rule;
