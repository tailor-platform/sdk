import { writeFileSync } from "fs";
import { parseSync } from "oxc-parser";
import type { OperatorFieldConfig } from "@/configure/types/operator";
import type {
  Program,
  ArrowFunctionExpression,
  Function as OxcFunction,
  VariableDeclarator,
  IdentifierReference,
  BindingIdentifier,
  ObjectPattern,
  BindingProperty,
  ArrayPattern,
  AssignmentPattern,
  BindingRestElement,
  Class as OxcClass,
} from "@oxc-project/types";

type FunctionExpression = OxcFunction;

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
      const declarator = node as unknown as VariableDeclarator;
      const id = declarator.id;
      if (id) collectBindingsFromPattern(id as unknown as ASTNode, localNames);
    }
    // Named function / class declarations
    if (type === "FunctionDeclaration") {
      const func = node as unknown as OxcFunction;
      const id = func.id;
      if (id && id.type === "Identifier") {
        localNames.add(id.name);
      }
    }
    if (type === "ClassDeclaration") {
      const clazz = node as unknown as OxcClass;
      const id = clazz.id;
      if (id && id.type === "Identifier") {
        localNames.add(id.name);
      }
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
      const identifier = node as unknown as IdentifierReference;
      const name = identifier.name;
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
    case "BindingIdentifier": {
      const bindingId = pattern as unknown as BindingIdentifier;
      if (bindingId.name) names.add(bindingId.name);
      break;
    }
    case "Identifier": {
      const identifier = pattern as unknown as IdentifierReference;
      if (identifier.name) names.add(identifier.name);
      break;
    }
    // ({value}) => {...} -> {"type": "ObjectPattern, "properties": [{type: "Property", value: {"type": "Identifier", name: "value"}}]}
    case "ObjectPattern": {
      const objectPattern = pattern as unknown as ObjectPattern;
      const properties = objectPattern.properties as
        | (BindingProperty | BindingRestElement)[]
        | undefined;
      for (const prop of properties ?? []) {
        if (prop.type === "Property") {
          const bindingProp = prop as BindingProperty;
          const value = bindingProp.value;
          if (value)
            collectBindingsFromPattern(value as unknown as ASTNode, names);
        }

        if (prop.type === "RestElement") {
          const rest = prop as BindingRestElement;
          const arg = rest.argument;
          if (arg) collectBindingsFromPattern(arg as unknown as ASTNode, names);
        }
      }
      break;
    }
    case "ArrayPattern": {
      const arrayPattern = pattern as unknown as ArrayPattern;
      const elements = arrayPattern.elements as
        | (
            | AssignmentPattern
            | BindingIdentifier
            | ObjectPattern
            | ArrayPattern
            | BindingRestElement
            | null
          )[]
        | undefined;
      for (const elem of elements ?? []) {
        if (!elem) continue;
        collectBindingsFromPattern(elem as unknown as ASTNode, names);
      }
      break;
    }
    case "AssignmentPattern": {
      const assignment = pattern as unknown as AssignmentPattern;
      const left = assignment.left;
      if (left) collectBindingsFromPattern(left as unknown as ASTNode, names);
      break;
    }
    case "RestElement": {
      const rest = pattern as unknown as BindingRestElement;
      const arg = rest.argument;
      if (arg) collectBindingsFromPattern(arg as unknown as ASTNode, names);
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
