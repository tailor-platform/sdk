import {
  type AstCallExpression,
  type AstNode,
  type AstProperty,
  objectProperty,
  parentOf,
} from "./ast.js";
import type { ImportTracker } from "./sdk-bindings.js";

export interface WorkflowJobDefinition {
  call: AstCallExpression;
  options: AstNode | undefined;
  name: AstProperty | null;
  body: AstProperty | null;
}

const FUNCTION_TYPES: ReadonlySet<string> = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

export function workflowJobDefinition(
  imports: ImportTracker,
  call: AstCallExpression,
): WorkflowJobDefinition | null {
  if (imports.callName(call) !== "createWorkflowJob") return null;
  const options = call.arguments[0];
  const object = options?.type === "ObjectExpression" ? options : null;
  return {
    call,
    options,
    name: objectProperty(object, "name"),
    body: objectProperty(object, "body"),
  };
}

export function isInsideFunction(node: AstNode): boolean {
  for (let current = parentOf(node); current !== null; current = parentOf(current)) {
    if (FUNCTION_TYPES.has(current.type)) return true;
  }
  return false;
}

export function hasAncestor(node: AstNode, ancestors: ReadonlySet<AstNode>): boolean {
  for (let current = parentOf(node); current !== null; current = parentOf(current)) {
    if (ancestors.has(current)) return true;
  }
  return false;
}
