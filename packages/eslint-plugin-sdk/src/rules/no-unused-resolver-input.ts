import {
  type AstCallExpression,
  type AstFunctionExpression,
  type AstIdentifier,
  type AstNode,
  type AstProperty,
  isFunctionExpression,
  isTypePosition,
  literalProperties,
  literalProperty,
  memberName,
  outermostWrapper,
  parentOf,
  propertyName,
  staticString,
  unwrapExpression,
} from "../lib/ast.js";
import { permissionInputFields } from "../lib/resolver-permission.js";
import {
  configureImportTracker,
  constInitializer,
  findVariable,
  type ImportTracker,
  resolveValue,
} from "../lib/sdk-bindings.js";
import type { Rule } from "eslint";

class Undetermined extends Error {}

type AstFunction = AstFunctionExpression | Extract<AstNode, { type: "FunctionDeclaration" }>;
type AstObjectPattern = Extract<AstNode, { type: "ObjectPattern" }>;
type Usage = { kind: "member"; member: AstNode; key: string } | { kind: "alias"; binding: AstNode };

function bodyFunction(context: Rule.RuleContext, property: AstProperty): AstFunction | null {
  if (property.kind !== "init") return null;
  const value = resolveValue(context, property.value);
  if (isFunctionExpression(value)) return value;
  if (value?.type !== "Identifier") return null;
  const variable = findVariable(context.sourceCode, value);
  const [definition] = variable?.defs ?? [];
  if (variable?.defs.length !== 1 || variable.references.some((reference) => reference.isWrite())) {
    return null;
  }
  return definition?.type === "FunctionName" ? (definition.node as AstFunction) : null;
}

function mayValidate(context: Rule.RuleContext, imports: ImportTracker, field: AstNode): boolean {
  const seen = new Set<AstNode>();
  const visit = (node: AstNode | null | undefined): boolean => {
    const value = unwrapExpression(node);
    if (value === null || value === undefined || seen.has(value)) return false;
    seen.add(value);
    switch (value.type) {
      case "Identifier": {
        if (imports.importedName(value) !== null || imports.isNamespace(value)) return false;
        const initializer = constInitializer(context, value);
        return initializer === null || visit(initializer);
      }
      case "CallExpression":
        return (
          memberName(unwrapExpression(value.callee)) === "validate" ||
          visit(value.callee) ||
          value.arguments.some((argument) =>
            visit(argument.type === "SpreadElement" ? argument.argument : argument),
          )
        );
      case "MemberExpression":
        return visit(value.object) || (value.computed && visit(value.property));
      case "ObjectExpression":
        return value.properties.some((property) =>
          property.type === "SpreadElement"
            ? visit(property.argument)
            : (property.computed && visit(property.key)) || visit(property.value),
        );
      case "ArrayExpression":
        return value.elements.some((element) =>
          visit(element?.type === "SpreadElement" ? element.argument : element),
        );
      case "TemplateLiteral":
        return value.expressions.some(visit);
      case "Literal":
        return false;
      default:
        return true;
    }
  };
  return visit(field);
}

function patternProperties(pattern: AstObjectPattern): { key: string; value: AstNode }[] {
  return pattern.properties.map((property) => {
    if (property.type !== "Property") throw new Undetermined();
    const key = property.computed ? staticString(property.key) : propertyName(property);
    if (key === null) throw new Undetermined();
    return { key, value: property.value };
  });
}

function readInputFields(context: Rule.RuleContext, fn: AstFunction): Set<string> {
  const reads = new Set<string>();

  const references = (binding: AstIdentifier): AstNode[] => {
    const variable = findVariable(context.sourceCode, binding);
    if (variable === null) throw new Undetermined();
    return variable.references.flatMap((reference) => {
      const identifier = reference.identifier as AstIdentifier;
      if (reference.init || isTypePosition(identifier)) return [];
      if (reference.isWrite()) throw new Undetermined();
      return [identifier];
    });
  };

  const followBinding = (
    binding: AstNode,
    readPattern: (pattern: AstObjectPattern) => void,
  ): AstNode[] => {
    const target = binding.type === "AssignmentPattern" ? binding.left : binding;
    if (target.type === "Identifier") return references(target);
    if (target.type !== "ObjectPattern") throw new Undetermined();
    readPattern(target);
    return [];
  };

  const usage = (node: AstNode): Usage => {
    const target = outermostWrapper(node);
    const parent = parentOf(target);
    if (
      (parent?.type === "MemberExpression" || parent?.type === "OptionalMemberExpression") &&
      parent.object === target
    ) {
      const key = memberName(parent);
      if (key === null) throw new Undetermined();
      return { kind: "member", member: parent, key };
    }
    if (parent?.type === "VariableDeclarator" && parent.init === target) {
      return { kind: "alias", binding: parent.id };
    }
    throw new Undetermined();
  };

  const readInput = (binding: AstNode) => {
    const expressions = followBinding(binding, (pattern) => {
      for (const { key } of patternProperties(pattern)) reads.add(key);
    });
    for (const expression of expressions) readInputExpression(expression);
  };

  const readInputExpression = (node: AstNode): void => {
    const use = usage(node);
    if (use.kind === "member") reads.add(use.key);
    else readInput(use.binding);
  };

  const readContext = (binding: AstNode) => {
    const expressions = followBinding(binding, (pattern) => {
      for (const { key, value } of patternProperties(pattern)) {
        if (key === "input") readInput(value);
      }
    });
    for (const expression of expressions) {
      const use = usage(expression);
      if (use.kind === "alias") readContext(use.binding);
      else if (use.key === "input") readInputExpression(use.member);
    }
  };

  if (fn.type !== "ArrowFunctionExpression") {
    const args = context.sourceCode.getScope(fn).set.get("arguments");
    if ((args?.references.length ?? 0) > 0) throw new Undetermined();
  }
  const [parameter] = fn.params;
  if (parameter !== undefined) readContext(parameter);
  return reads;
}

function checkResolver(
  context: Rule.RuleContext,
  imports: ImportTracker,
  call: AstCallExpression,
): void {
  const config = resolveValue(context, call.arguments[0]);
  if (literalProperties(config) === null) return;
  const input = literalProperty(config, "input");
  const body = literalProperty(config, "body");
  const fields = literalProperties(resolveValue(context, input?.value));
  const fn = body === null ? null : bodyFunction(context, body);
  if (fields === null || fn === null) return;

  const permission = literalProperty(config, "permission");
  const compared =
    permission === null ? new Set<string>() : permissionInputFields(context, permission.value);
  if (compared === null) return;

  let reads: Set<string>;
  try {
    reads = readInputFields(context, fn);
  } catch (error) {
    if (error instanceof Undetermined) return;
    throw error;
  }

  const declared = new Map(fields.map((field) => [propertyName(field), field]));
  for (const [name, field] of declared) {
    if (name === null || reads.has(name) || compared.has(name)) continue;
    if (mayValidate(context, imports, field.value)) continue;
    context.report({ node: field, messageId: "unusedInput", data: { field: name } });
  }
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Report resolver input fields that `body` never reads.",
    },
    messages: {
      unusedInput:
        "Input field `{{field}}` is never read by `body`, so a caller may expect it to take effect. Read it in `body`, or remove it from `input`.",
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
