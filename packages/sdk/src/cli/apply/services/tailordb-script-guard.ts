import { writeFileSync } from "fs";
import { parseSync } from "oxc-parser";
import type { OperatorFieldConfig } from "@/configure/types/operator";
import type {
  Program,
  ArrowFunctionExpression,
  Function as FunctionExpression,
} from "@oxc-project/types";

type ASTNode = Record<string, unknown> & { type?: string };

// Only arrow functions or function expressions are treated as script entry points
const functionTypes = ["ArrowFunctionExpression", "FunctionExpression"];

const allowedGlobalIdentifiers = new Set<string>([
  // Common built-ins
  "Math",
  "Date",
  "Number",
  "String",
  "Boolean",
  "JSON",
  "Array",
  "Object",
  "BigInt",
  "Promise",
  "RegExp",
  "Error",
  "Set",
  "Map",
  "WeakMap",
  "WeakSet",
  "Symbol",
  "Intl",
]);

interface ScriptContext {
  typeName: string;
  fieldName: string;
  kind: "validate" | "hook.create" | "hook.update";
}
export function ensureNoExternalVariablesInFieldScripts(
  typeName: string,
  fieldName: string,
  fieldConfig: OperatorFieldConfig,
): void {
  // Validate scripts
  for (const validateConfig of fieldConfig.validate ?? []) {
    const expr = validateConfig.script?.expr;
    if (expr) {
      checkScriptForExternalVariables(expr, {
        typeName,
        fieldName,
        kind: "validate",
      });
    }
  }

  // Hook scripts (create/update)
  if (fieldConfig.hooks?.create?.expr) {
    checkScriptForExternalVariables(fieldConfig.hooks.create.expr, {
      typeName,
      fieldName,
      kind: "hook.create",
    });
  }
  if (fieldConfig.hooks?.update?.expr) {
    checkScriptForExternalVariables(fieldConfig.hooks.update.expr, {
      typeName,
      fieldName,
      kind: "hook.update",
    });
  }
}

function checkScriptForExternalVariables(
  expr: string,
  ctx: ScriptContext,
): void {
  if (!expr.trim()) return;

  console.log("🔥 expr");
  console.log(expr);

  let program: Program;
  try {
    ({ program } = parseSync("tailordb-script.ts", expr));
  } catch (error) {
    // If we can't even parse the script, fail fast with a clear message.
    throw new Error(
      `Failed to parse TailorDB ${ctx.kind} script for ${ctx.typeName}.${ctx.fieldName}: ${String(error)}`,
    );
  }

  const fn = findFirstFunction(program);
  console.log("fn");
  console.log(JSON.stringify(fn, null, 2));

  if (!fn) {
    return;
  }

  const localNames = new Set<string>();
  collectFunctionBindings(fn, localNames);
  console.log("💕localNames");
  console.log(JSON.stringify([...localNames], null, 2));

  const externalNames = collectExternalIdentifierReferences(fn, localNames);
  if (externalNames.size === 0) return;

  const namesList = [...externalNames].sort().join(", ");
  throw new Error(
    `TailorDB ${ctx.kind} for ${ctx.typeName}.${ctx.fieldName} captures external variables (${namesList}). ` +
      "Hooks and validators must not reference variables outside their own parameters and local declarations.",
  );
}

function findFirstFunction(
  program: Program,
): ArrowFunctionExpression | FunctionExpression | null {
  let found: ArrowFunctionExpression | FunctionExpression | null = null;

  try {
    writeFileSync("./ast-program.json", JSON.stringify(program, null, 2));
    console.log("✅ write success");
  } catch (error) {
    console.log("❌ parse error");
    console.log(String(error));
  }

  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object" || found) return;

    console.log("✨ walk node type");
    console.log(JSON.stringify(node.type, null, 2));

    const type = node.type;
    if (type && functionTypes.includes(type)) {
      found = node as unknown as ArrowFunctionExpression | FunctionExpression;
      return;
    }

    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === "object") {
            walk(child as ASTNode);
          }
        }
      } else if (value && typeof value === "object") {
        walk(value as ASTNode);
      }
    }
  }

  walk(program as unknown as ASTNode);
  return found;
}

// Collect parameters, local variables, and named function/class declarations within the function
function collectFunctionBindings(
  fn: ArrowFunctionExpression | FunctionExpression,
  localNames: Set<string>,
): void {
  // Parameters
  for (const param of fn.params ?? []) {
    // Cast through unknown to satisfy TypeScript that we're treating the
    // parsed node as a generic ASTNode shape.
    collectBindingsFromPattern(param as unknown as ASTNode, localNames);
  }

  // Local declarations (variables / functions / classes) inside the function body
  const bodyNode =
    fn.body && typeof fn.body === "object"
      ? (fn.body as unknown as ASTNode)
      : null;
  if (!bodyNode) return;

  traverse(bodyNode, (node) => {
    const type = node.type;
    // Variable declarations
    // Local variables are represented as VariableDeclarator nodes
    if (type === "VariableDeclarator") {
      console.log("😊 VariableDeclarato node");
      console.log(JSON.stringify(node, null, 2));
      const id = node.id as ASTNode | undefined;
      if (id) collectBindingsFromPattern(id, localNames);
    }
    // Named function / class declarations
    if (
      (type === "FunctionDeclaration" || type === "ClassDeclaration") &&
      (node as any).id &&
      (node as any).id.type === "Identifier"
    ) {
      localNames.add((node as any).id.name as string);
    }
  });
}

function collectExternalIdentifierReferences(
  fn: ArrowFunctionExpression | FunctionExpression,
  localNames: Set<string>,
): Set<string> {
  const external = new Set<string>();

  const bodyNode =
    fn.body && typeof fn.body === "object"
      ? (fn.body as unknown as ASTNode)
      : null;
  if (!bodyNode) return external;

  traverse(bodyNode, (node) => {
    if (node.type === "Identifier") {
      const name = (node as any).name as string;
      if (!name) return;
      if (localNames.has(name)) return;
      if (allowedGlobalIdentifiers.has(name)) return;
      external.add(name);
    }
  });

  return external;
}

// Extract binding names from parameter patterns and declaration nodes in the body
function collectBindingsFromPattern(
  pattern: ASTNode,
  names: Set<string>,
): void {
  switch (pattern.type) {
    case "BindingIdentifier":
    case "Identifier": {
      const name = (pattern as any).name as string | undefined;
      if (name) names.add(name);
      break;
    }
    // ({value}) => {...} -> {"type": "ObjectPattern, "properties": [{type: "Property", value: {"type": "Identifier", name: "value"}}]}
    case "ObjectPattern": {
      const properties = (pattern as any).properties as ASTNode[] | undefined;
      for (const prop of properties ?? []) {
        if (prop.type === "BindingProperty") {
          const value = (prop as any).value as ASTNode | undefined;
          if (value) collectBindingsFromPattern(value, names);
        }

        if (prop.type === "Property") {
          // Destructuring parameter pattern: { value }
          const value = (prop as any).value as ASTNode | undefined;
          if (value) collectBindingsFromPattern(value, names);
        }

        if (prop.type === "RestElement") {
          const arg = (prop as any).argument as ASTNode | undefined;
          if (arg) collectBindingsFromPattern(arg, names);
        }
      }
      break;
    }
    case "ArrayPattern": {
      const elements = (pattern as any).elements as
        | (ASTNode | null)[]
        | undefined;
      for (const elem of elements ?? []) {
        if (!elem) continue;
        if (elem.type === "SpreadElement") {
          const arg = (elem as any).argument as ASTNode | undefined;
          if (arg) collectBindingsFromPattern(arg, names);
        } else {
          collectBindingsFromPattern(elem, names);
        }
      }
      break;
    }
    case "AssignmentPattern": {
      const left = (pattern as any).left as ASTNode | undefined;
      if (left) collectBindingsFromPattern(left, names);
      break;
    }
    case "RestElement": {
      const arg = (pattern as any).argument as ASTNode | undefined;
      if (arg) collectBindingsFromPattern(arg, names);
      break;
    }
    default:
      break;
  }
}

function traverse(node: ASTNode, visitor: (node: ASTNode) => void): void {
  visitor(node);

  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (!value) continue;

    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === "object") {
          traverse(child as ASTNode, visitor);
        }
      }
    } else if (value && typeof value === "object") {
      traverse(value as ASTNode, visitor);
    }
  }
}
