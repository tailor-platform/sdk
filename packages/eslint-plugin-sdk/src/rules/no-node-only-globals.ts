import {
  describeUnavailable,
  getForbiddenGlobalMessage,
  NODE_ONLY_GLOBAL_NAMES,
} from "@tailor-platform/shared/node-builtins";
import {
  type AstCallExpression,
  type AstIdentifier,
  type AstNode,
  isTypePosition,
  isValueReference,
  parentOf,
  staticString,
} from "../lib/ast.js";
import { platformFunctionFactories, suggestsAlternatives } from "../lib/platform-functions.js";
import { configureImportTracker, isLocalBinding } from "../lib/sdk-bindings.js";
import type { Rule } from "eslint";

const NEGATIVE_EQUALITY = new Set(["!=", "!=="]);
const POSITIVE_EQUALITY = new Set(["==", "==="]);

interface TypeofGuard {
  name: string;
  declaredWhenTrue: boolean;
}

function typeofOperand(node: AstNode | null | undefined): string | null {
  return node?.type === "UnaryExpression" &&
    node.operator === "typeof" &&
    node.argument.type === "Identifier"
    ? node.argument.name
    : null;
}

function typeofGuard(node: AstNode | null | undefined): TypeofGuard | null {
  if (node?.type !== "BinaryExpression") return null;
  const isNegative = NEGATIVE_EQUALITY.has(node.operator);
  if (!isNegative && !POSITIVE_EQUALITY.has(node.operator)) return null;
  const leftName = typeofOperand(node.left);
  const name = leftName ?? typeofOperand(node.right);
  const literal = staticString(leftName === null ? node.left : node.right);
  if (name === null || literal === null) return null;
  return { name, declaredWhenTrue: isNegative === (literal === "undefined") };
}

function isGuarded(node: AstIdentifier): boolean {
  let child: AstNode = node;
  for (let parent = parentOf(child); parent !== null; child = parent, parent = parentOf(parent)) {
    if (parent.type === "LogicalExpression" && parent.right === child) {
      const guard = typeofGuard(parent.left);
      if (guard?.name === node.name && guard.declaredWhenTrue === (parent.operator === "&&")) {
        return true;
      }
    }
    if (parent.type === "ConditionalExpression" || parent.type === "IfStatement") {
      const guard = typeofGuard(parent.test);
      if (guard?.name === node.name) {
        if (parent.consequent === child && guard.declaredWhenTrue) return true;
        if (parent.alternate === child && !guard.declaredWhenTrue) return true;
      }
    }
  }
  return false;
}

function isRuntimeGlobalReference(context: Rule.RuleContext, node: AstIdentifier): boolean {
  return (
    isValueReference(node) &&
    typeofOperand(parentOf(node)) === null &&
    !isTypePosition(node) &&
    !isLocalBinding(context, node) &&
    !isGuarded(node)
  );
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Node-only globals in files that define a resolver, executor, workflow job, or HTTP adapter.",
    },
    messages: {
      unavailable: "{{message}}",
    },
    schema: [],
  },
  create(context) {
    const imports = configureImportTracker(context);
    const calls: AstCallExpression[] = [];
    const identifiers: AstIdentifier[] = [];

    return {
      ImportDeclaration: (node) => imports.track(node),
      CallExpression: (node) => calls.push(node),
      Identifier: (node) => {
        if (NODE_ONLY_GLOBAL_NAMES.includes(node.name)) identifiers.push(node);
      },
      "Program:exit"() {
        const factories = platformFunctionFactories(imports, calls);
        if (factories.size === 0) return;
        const describe = suggestsAlternatives(factories)
          ? getForbiddenGlobalMessage
          : describeUnavailable;
        for (const node of identifiers) {
          if (!isRuntimeGlobalReference(context, node)) continue;
          context.report({
            node,
            messageId: "unavailable",
            data: { message: describe(node.name) },
          });
        }
      },
    };
  },
} satisfies Rule.RuleModule;

export default rule;
