import {
  EXECUTION_POLICY_KEY_MESSAGE,
  EXECUTION_POLICY_KEY_PATTERN,
  EXECUTION_POLICY_KEY_WILDCARD_MESSAGE,
  EXECUTION_POLICY_NAME_MESSAGE,
  EXECUTION_POLICY_NAME_PATTERN,
  toPlatformExecutionPolicyKey,
} from "@tailor-platform/shared/workflow-policy";
import {
  type AstCallExpression,
  type AstNode,
  type AstProperty,
  literalProperties,
  propertyName,
  returnStatements,
  staticString,
  unwrapExpression,
} from "../lib/ast.js";
import { configureImportTracker, isBindingReference, resolveValue } from "../lib/sdk-bindings.js";
import type { Rule } from "eslint";

interface StaticOption {
  value: string;
  node: AstNode;
}

interface PolicyOptions {
  name?: StaticOption;
  key?: StaticOption;
  matchType: "exact" | "prefix";
}

function staticOption(
  context: Rule.RuleContext,
  properties: readonly AstProperty[],
  name: string,
): StaticOption | null | undefined {
  const property = properties.find((entry) => propertyName(entry) === name);
  if (property === undefined) return undefined;
  const value = staticString(resolveValue(context, property.value));
  return value === null ? null : { value, node: property.value };
}

function readOptions(
  context: Rule.RuleContext,
  node: AstNode | null | undefined,
): PolicyOptions | null {
  if (node === null || node === undefined) return { matchType: "exact" };
  const properties = literalProperties(resolveValue(context, node));
  if (properties === null) return null;
  const name = staticOption(context, properties, "name");
  const key = staticOption(context, properties, "key");
  const matchType = staticOption(context, properties, "matchType");
  if (name === null || key === null || matchType === null) return null;
  const kind = matchType?.value ?? "exact";
  if (kind !== "exact" && kind !== "prefix") return null;
  return { name, key, matchType: kind };
}

function checkPolicy(context: Rule.RuleContext, name: StaticOption, options: PolicyOptions): void {
  if (!EXECUTION_POLICY_NAME_PATTERN.test(name.value)) {
    context.report({
      node: name.node,
      messageId: "invalidName",
      data: { message: EXECUTION_POLICY_NAME_MESSAGE, value: name.value },
    });
  }
  const key = options.key ?? name;
  if (key.value.endsWith("*")) {
    context.report({
      node: key.node,
      messageId: "invalidKey",
      data: { message: EXECUTION_POLICY_KEY_WILDCARD_MESSAGE, value: key.value },
    });
    return;
  }
  const platformKey = toPlatformExecutionPolicyKey(key.value, options.matchType);
  if (!EXECUTION_POLICY_KEY_PATTERN.test(platformKey)) {
    context.report({
      node: key.node,
      messageId: "invalidKey",
      data: { message: EXECUTION_POLICY_KEY_MESSAGE, value: platformKey },
    });
  }
}

function returnedValues(context: Rule.RuleContext, body: AstNode): (AstNode | null | undefined)[] {
  if (body.type !== "BlockStatement") return [resolveValue(context, body)];
  return returnStatements(body).map((statement) => resolveValue(context, statement.argument));
}

function checkPolicyGroup(context: Rule.RuleContext, call: AstCallExpression): void {
  const builder = unwrapExpression(call.arguments[0]);
  if (builder?.type !== "ArrowFunctionExpression" && builder?.type !== "FunctionExpression") {
    return;
  }
  const define = builder.params[0];
  if (define?.type !== "Identifier") return;
  for (const returned of returnedValues(context, builder.body)) {
    const policies = literalProperties(returned);
    if (policies === null) continue;
    for (const property of policies) {
      const name = propertyName(property);
      const definition = unwrapExpression(property.value);
      if (name === null || definition?.type !== "CallExpression") continue;
      if (!isBindingReference(context, unwrapExpression(definition.callee), define)) continue;
      const options = readOptions(context, definition.arguments[0]);
      if (options === null) continue;
      checkPolicy(context, options.name ?? { value: name, node: property.key }, options);
    }
  }
}

function checkSinglePolicy(context: Rule.RuleContext, call: AstCallExpression): void {
  const nameNode = call.arguments[0];
  const name = staticString(resolveValue(context, nameNode));
  if (nameNode === undefined || name === null) return;
  const options = readOptions(context, call.arguments[1]);
  // `defineWorkflowExecutionPolicy` types `def` as `Omit<ExecutionPolicyDefInput, "name">`
  // and only ever reads the positional name, so a stray `def.name` must not override it.
  if (options !== null) checkPolicy(context, { value: name, node: nameNode }, options);
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require workflow execution policy names and keys to match the platform grammar the deploy validates.",
    },
    messages: {
      invalidName: '{{message}} (got "{{value}}")',
      invalidKey: '{{message}} (got "{{value}}")',
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
          const name = imports.callName(call);
          if (name === "defineWorkflowExecutionPolicies") checkPolicyGroup(context, call);
          if (name === "defineWorkflowExecutionPolicy") checkSinglePolicy(context, call);
        }
      },
    };
  },
} satisfies Rule.RuleModule;

export default rule;
