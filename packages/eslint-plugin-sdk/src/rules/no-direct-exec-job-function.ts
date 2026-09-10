import { type AstCallExpression, type AstNode, memberName, unwrapExpression } from "../lib/ast.js";
import { type ImportTracker, isLocalBinding, runtimeImportTracker } from "../lib/sdk-bindings.js";
import type { Rule } from "eslint";

function isAmbientTailor(context: Rule.RuleContext, node: AstNode | null | undefined): boolean {
  return node?.type === "Identifier" && node.name === "tailor" && !isLocalBinding(context, node);
}

function isWorkflowRuntime(
  context: Rule.RuleContext,
  imports: ImportTracker,
  node: AstNode | null | undefined,
): boolean {
  const value = unwrapExpression(node);
  if (value?.type === "Identifier") return imports.importedAs(value, "workflow");
  if (value?.type !== "MemberExpression" && value?.type !== "OptionalMemberExpression") {
    return false;
  }
  if (memberName(value) !== "workflow") return false;
  const object = unwrapExpression(value.object);
  return isAmbientTailor(context, object) || imports.isNamespace(object);
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow calling execJobFunction directly instead of starting a workflow job through its .start() method.",
    },
    messages: {
      directCall:
        "Do not call execJobFunction directly; a direct call is never detected as a job dependency, so the target job is dropped from the bundle. Call the target job's .start() from inside a job body instead.",
    },
    schema: [],
  },
  create(context) {
    const imports = runtimeImportTracker(context);
    const calls: AstCallExpression[] = [];

    return {
      ImportDeclaration: (node) => imports.track(node),
      CallExpression: (node) => calls.push(node),
      "Program:exit"() {
        for (const call of calls) {
          const callee = unwrapExpression(call.callee);
          if (callee?.type !== "MemberExpression" && callee?.type !== "OptionalMemberExpression") {
            continue;
          }
          if (memberName(callee) !== "execJobFunction") continue;
          if (!isWorkflowRuntime(context, imports, callee.object)) continue;
          context.report({ node: call, messageId: "directCall" });
        }
      },
    };
  },
} satisfies Rule.RuleModule;

export default rule;
