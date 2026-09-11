import { durationToSeconds, RETRY_POLICY_LIMITS } from "@tailor-platform/shared/workflow-policy";
import {
  type AstCallExpression,
  type AstNode,
  type AstProperty,
  literalProperties,
  literalProperty,
  namedProperty,
  staticString,
  unwrapExpression,
} from "../lib/ast.js";
import { configureImportTracker, resolveValue } from "../lib/sdk-bindings.js";
import type { Rule } from "eslint";

interface Duration {
  seconds: number;
  node: AstNode;
}

function numberValue(context: Rule.RuleContext, node: AstNode | null | undefined): number | null {
  const value = unwrapExpression(resolveValue(context, node));
  if (value?.type === "Literal" && typeof value.value === "number") return value.value;
  if (value?.type !== "UnaryExpression" || value.operator !== "-") return null;
  const operand = unwrapExpression(value.argument);
  return operand?.type === "Literal" && typeof operand.value === "number" ? -operand.value : null;
}

function checkDuration(
  context: Rule.RuleContext,
  properties: readonly AstProperty[],
  field: string,
  maxSeconds: number,
): Duration | null {
  const property = namedProperty(properties, field);
  if (property === null) return null;
  const text = staticString(resolveValue(context, property.value));
  if (text === null) return null;
  const seconds = durationToSeconds(text);
  if (seconds === null || seconds <= 0) {
    context.report({ node: property.value, messageId: "invalidDuration", data: { field } });
    return null;
  }
  if (seconds > maxSeconds) {
    context.report({
      node: property.value,
      messageId: "durationTooLong",
      data: { field, max: String(maxSeconds) },
    });
  }
  return { seconds, node: property.value };
}

function checkRetryPolicy(context: Rule.RuleContext, node: AstNode): void {
  const properties = literalProperties(resolveValue(context, node));
  if (properties === null) return;

  const maxRetries = namedProperty(properties, "maxRetries");
  const retries = numberValue(context, maxRetries?.value);
  if (
    maxRetries !== null &&
    retries !== null &&
    (!Number.isInteger(retries) ||
      retries < RETRY_POLICY_LIMITS.maxRetries.min ||
      retries > RETRY_POLICY_LIMITS.maxRetries.max)
  ) {
    context.report({ node: maxRetries.value, messageId: "maxRetriesRange" });
  }

  const multiplier = namedProperty(properties, "backoffMultiplier");
  const factor = numberValue(context, multiplier?.value);
  if (multiplier !== null && factor !== null && factor < RETRY_POLICY_LIMITS.backoffMultiplierMin) {
    context.report({ node: multiplier.value, messageId: "backoffMultiplierMin" });
  }

  const initial = checkDuration(
    context,
    properties,
    "initialBackoff",
    RETRY_POLICY_LIMITS.initialBackoffMaxSeconds,
  );
  const max = checkDuration(
    context,
    properties,
    "maxBackoff",
    RETRY_POLICY_LIMITS.maxBackoffMaxSeconds,
  );
  if (initial !== null && max !== null && initial.seconds > max.seconds) {
    context.report({ node: initial.node, messageId: "backoffOrder" });
  }
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require workflow retry policies with literal values to satisfy the limits the build validates.",
    },
    messages: {
      backoffOrder: "initialBackoff must be less than or equal to maxBackoff.",
      invalidDuration: '{{field}} must be a positive duration such as "500ms", "1s", or "1m".',
      durationTooLong: "{{field}} must be at most {{max}} seconds.",
      maxRetriesRange: "maxRetries must be an integer between 1 and 10.",
      backoffMultiplierMin: "backoffMultiplier must be at least 1.",
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
          if (imports.callName(call) !== "createWorkflow") continue;
          const retryPolicy = literalProperty(
            resolveValue(context, call.arguments[0]),
            "retryPolicy",
          );
          if (retryPolicy !== null) checkRetryPolicy(context, retryPolicy.value);
        }
      },
    };
  },
} satisfies Rule.RuleModule;

export default rule;
