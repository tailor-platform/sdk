const EXPRESSION_WRAPPERS = new Set([
  "ChainExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "TypeCastExpression",
]);

export function unwrapExpression(node) {
  let current = node;
  while (current !== null && current !== undefined && EXPRESSION_WRAPPERS.has(current.type)) {
    current = current.expression;
  }
  return current;
}

export function memberName(node) {
  if (!node || (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression")) {
    return null;
  }
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  if (
    node.computed &&
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  ) {
    return node.property.value;
  }
  return null;
}

export function nodeStart(node) {
  if (Array.isArray(node.range)) return node.range[0];
  return typeof node.start === "number" ? node.start : 0;
}

export function staticString(node) {
  const value = unwrapExpression(node);
  if (value?.type === "Literal" && typeof value.value === "string") {
    return value.value;
  }
  if (value?.type === "TemplateLiteral" && value.expressions.length === 0) {
    return value.quasis[0]?.value.cooked ?? value.quasis[0]?.value.raw ?? null;
  }
  return null;
}

export function objectProperty(object, name) {
  const value = unwrapExpression(object);
  if (value?.type !== "ObjectExpression") return null;
  return (
    value.properties.findLast((property) => {
      if (property.type !== "Property" || property.kind !== "init") return false;
      if (!property.computed && property.key.type === "Identifier") {
        return property.key.name === name;
      }
      return property.key.type === "Literal" && property.key.value === name;
    }) ?? null
  );
}
