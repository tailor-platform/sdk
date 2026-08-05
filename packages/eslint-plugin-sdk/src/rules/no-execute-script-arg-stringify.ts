import {
  type AstCallExpression,
  type AstNode,
  memberName,
  objectProperty,
  unwrapExpression,
} from "../lib/ast.js";
import { cliImportTracker, resolveValue } from "../lib/sdk-bindings.js";
import type { Rule } from "eslint";

function isJsonStringifyCall(node: AstNode | null | undefined): boolean {
  if (node?.type !== "CallExpression") return false;
  const callee = unwrapExpression(node.callee);
  if (callee?.type !== "MemberExpression" && callee?.type !== "OptionalMemberExpression") {
    return false;
  }
  if (memberName(callee) !== "stringify") return false;
  const object = unwrapExpression(callee.object);
  return object?.type === "Identifier" && object.name === "JSON";
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow passing a JSON.stringify(...) result as executeScript's arg option.",
    },
    messages: {
      stringifiedArg:
        "executeScript serializes arg internally; pass the value directly instead of JSON.stringify(...) to avoid double-encoding.",
    },
    schema: [],
  },
  create(context) {
    const imports = cliImportTracker(context);
    const calls: AstCallExpression[] = [];

    return {
      ImportDeclaration: (node) => imports.track(node),
      CallExpression: (node) => calls.push(node),
      "Program:exit"() {
        for (const call of calls) {
          if (imports.callName(call) !== "executeScript") continue;
          const options = resolveValue(context, call.arguments[0]);
          const property = objectProperty(options, "arg");
          if (!property || property.type !== "Property") continue;
          if (!isJsonStringifyCall(resolveValue(context, property.value))) continue;
          context.report({ node: property.value, messageId: "stringifiedArg" });
        }
      },
    };
  },
} satisfies Rule.RuleModule;

export default rule;
