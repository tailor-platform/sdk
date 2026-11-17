import {
  type AstCallExpression,
  type AstNode,
  type AstProperty,
  literalElements,
  literalProperties,
  literalProperty,
  namedProperty,
  propertyName,
  staticBoolean,
  staticString,
  unwrapExpression,
} from "../lib/ast.js";
import {
  type ConditionTuple,
  conditionTuples,
  operand,
  policyPermit,
} from "../lib/resolver-permission.js";
import {
  configureImportTracker,
  type ImportTracker,
  resolveValue,
  sdkChainRoot,
} from "../lib/sdk-bindings.js";
import type { Rule } from "eslint";

const CALLER_ID_INPUT_NAMES = [
  /^(actor|approver|author|caller|creator|editor|executor|invoker|modifier|operator|performer|requester|requestor|reviewer|sender|submitter|updater|uploader)_?(user_?)?id$/i,
  /^current_?user_?id$/i,
  /^[A-Za-z][A-Za-z0-9]*By(User)?(Id|ID)?$/,
  /^[a-z][a-z0-9_]*_by(_user)?(_id)?$/i,
];

type Binding = "bound" | "unbound" | "unknown";

function isNonArrayUuidField(
  context: Rule.RuleContext,
  imports: ImportTracker,
  node: AstNode | null | undefined,
): boolean {
  const root = sdkChainRoot(context, imports, node);
  if (root?.method !== "uuid") return false;
  const options = root.call.arguments[0];
  if (options === undefined) return true;
  const properties = literalProperties(resolveValue(context, options));
  if (properties === null) return false;
  const array = namedProperty(properties, "array");
  return array === null || staticBoolean(resolveValue(context, array.value)) === false;
}

function tupleBinding(context: Rule.RuleContext, tuple: ConditionTuple, field: string): Binding {
  const [left, operator, right] = tuple.elements;
  if (left === undefined || operator === undefined || right === undefined) return "unknown";
  const sides = [operand(context, left), operand(context, right)];
  if (
    sides.some((side) => side.kind === "unknown" || (side.kind === "input" && side.field === null))
  ) {
    return "unknown";
  }
  return staticString(resolveValue(context, operator)) === "=" &&
    sides.some((side) => side.kind === "user") &&
    sides.some((side) => side.kind === "input" && side.field === field)
    ? "bound"
    : "unbound";
}

function policyBinding(
  context: Rule.RuleContext,
  policy: AstNode | null | undefined,
  field: string,
): Binding {
  const conditions = resolveValue(context, literalProperty(policy, "conditions")?.value);
  const elements = literalElements(conditions);
  if (conditions === null || conditions === undefined || elements === null) return "unknown";
  const { tuples, complete } = conditionTuples(context, conditions, elements);
  const bindings = tuples.map((tuple) => tupleBinding(context, tuple, field));
  if (bindings.includes("bound")) return "bound";
  return complete && !bindings.includes("unknown") ? "unbound" : "unknown";
}

function unboundReason(
  context: Rule.RuleContext,
  permission: AstProperty | null,
  field: string,
): "noPolicy" | "unboundPolicy" | null {
  if (permission === null) return "noPolicy";
  const value = unwrapExpression(resolveValue(context, permission.value));
  if (staticString(value) === "allowAnonymous") return "noPolicy";
  if (value?.type !== "ArrayExpression") return null;
  const unbound = value.elements.some((element) => {
    if (element === null || element.type === "SpreadElement") return false;
    const policy = resolveValue(context, element);
    return (
      policyPermit(context, policy) === true && policyBinding(context, policy, field) === "unbound"
    );
  });
  return unbound ? "unboundPolicy" : null;
}

function inputFields(context: Rule.RuleContext, input: AstProperty | null): AstProperty[] {
  const value = unwrapExpression(resolveValue(context, input?.value));
  if (value?.type !== "ObjectExpression") return [];
  const lastSpread = value.properties.findLastIndex(
    (property) => property.type === "SpreadElement",
  );
  return value.properties
    .slice(lastSpread + 1)
    .filter((property): property is AstProperty => property.type === "Property");
}

function checkResolver(
  context: Rule.RuleContext,
  imports: ImportTracker,
  call: AstCallExpression,
): void {
  const properties = literalProperties(resolveValue(context, call.arguments[0]));
  if (properties === null) return;
  const operation = staticString(
    resolveValue(context, namedProperty(properties, "operation")?.value),
  );
  if (operation !== "mutation") return;
  const permission = namedProperty(properties, "permission");
  for (const field of inputFields(context, namedProperty(properties, "input"))) {
    const name = propertyName(field);
    if (
      name === null ||
      !CALLER_ID_INPUT_NAMES.some((pattern) => pattern.test(name)) ||
      !isNonArrayUuidField(context, imports, field.value)
    ) {
      continue;
    }
    const messageId = unboundReason(context, permission, name);
    if (messageId !== null) context.report({ node: field, messageId, data: { name } });
  }
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a mutation's uuid input named like the caller's ID unless every `permit: true` policy compares it with the caller.",
    },
    messages: {
      noPolicy:
        '`{{name}}` looks like the caller\'s ID but no `permission` policy compares it with the caller, so a caller can act as another user by sending that user\'s ID. Take the acting user from `caller` in `body`, or declare `permission` with `permit: true` policies that each include `[{ input: "{{name}}" }, "=", { user: "id" }]`.',
      unboundPolicy:
        '`{{name}}` looks like the caller\'s ID but is not compared with the caller in every `permit: true` policy of `permission`, so a caller can act as another user by sending that user\'s ID. Take the acting user from `caller` in `body`, or add `[{ input: "{{name}}" }, "=", { user: "id" }]` to every `permit: true` policy.',
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
          if (imports.callName(call) === "createResolver") checkResolver(context, imports, call);
        }
      },
    };
  },
} satisfies Rule.RuleModule;

export default rule;
