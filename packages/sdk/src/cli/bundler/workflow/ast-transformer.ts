import { parseSync } from "oxc-parser";
import type {
  Program,
  Expression,
  AwaitExpression,
  ImportExpression,
  CallExpression,
  ImportDeclaration,
  VariableDeclaration,
  ObjectExpression,
  ObjectPropertyKind,
  ObjectProperty,
  StaticMemberExpression,
  IdentifierReference,
  ImportSpecifier,
  ImportDefaultSpecifier,
  ImportNamespaceSpecifier,
  ObjectPattern,
  BindingProperty,
  ExportNamedDeclaration,
  ArrowFunctionExpression,
  Function as FunctionExpression,
} from "@oxc-project/types";

/** A generic AST node for walking purposes */
type ASTNode = Record<string, unknown>;

interface JobLocation {
  name: string;
  nameRange: { start: number; end: number };
  depsRange?: { start: number; end: number };
  bodyValueRange: { start: number; end: number };
  // Range of the entire variable declaration statement (for removal)
  statementRange?: { start: number; end: number };
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

/**
 * Check if a module source is from @tailor-platform/sdk (including subpaths)
 */
function isTailorSdkSource(source: string): boolean {
  return /^@tailor-platform\/sdk(\/|$)/.test(source);
}

/**
 * Get the source string from a dynamic import or require call
 */
function getImportSource(node: Expression | null | undefined): string | null {
  if (!node) return null;
  // await import("@tailor-platform/sdk")
  if (node.type === "ImportExpression") {
    const importExpr = node as ImportExpression;
    const source = importExpr.source;
    if (source.type === "Literal" && typeof source.value === "string") {
      return source.value;
    }
  }
  // require("@tailor-platform/sdk")
  if (node.type === "CallExpression") {
    const callExpr = node as CallExpression;
    if (
      callExpr.callee.type === "Identifier" &&
      callExpr.callee.name === "require"
    ) {
      const arg = callExpr.arguments[0];
      if (
        arg &&
        "type" in arg &&
        arg.type === "Literal" &&
        "value" in arg &&
        typeof arg.value === "string"
      ) {
        return arg.value;
      }
    }
  }
  return null;
}

/**
 * Unwrap AwaitExpression to get the inner expression
 */
function unwrapAwait(
  node: Expression | null | undefined,
): Expression | null | undefined {
  if (node?.type === "AwaitExpression") {
    return (node as AwaitExpression).argument;
  }
  return node;
}

/**
 * Collect all import bindings for createWorkflowJob from @tailor-platform/sdk
 * Returns a Set of local names that refer to createWorkflowJob
 */
function collectCreateWorkflowJobBindings(program: Program): Set<string> {
  const bindings = new Set<string>();

  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object") return;

    const nodeType = node.type as string | undefined;

    // Static imports: import { createWorkflowJob } from "@tailor-platform/sdk"
    if (nodeType === "ImportDeclaration") {
      const importDecl = node as unknown as ImportDeclaration;
      const source = importDecl.source?.value;
      if (typeof source === "string" && isTailorSdkSource(source)) {
        for (const specifier of importDecl.specifiers || []) {
          // import { createWorkflowJob } from "@tailor-platform/sdk"
          // import { createWorkflowJob as create } from "@tailor-platform/sdk"
          if (specifier.type === "ImportSpecifier") {
            const importSpec = specifier as ImportSpecifier;
            const imported =
              importSpec.imported.type === "Identifier"
                ? importSpec.imported.name
                : (importSpec.imported as { value?: string }).value;
            if (imported === "createWorkflowJob") {
              bindings.add(importSpec.local?.name || imported);
            }
          }
          // import sdk from "@tailor-platform/sdk" → sdk.createWorkflowJob
          // import * as sdk from "@tailor-platform/sdk" → sdk.createWorkflowJob
          else if (
            specifier.type === "ImportDefaultSpecifier" ||
            specifier.type === "ImportNamespaceSpecifier"
          ) {
            const spec = specifier as
              | ImportDefaultSpecifier
              | ImportNamespaceSpecifier;
            // Store namespace/default with special prefix to track member access
            bindings.add(`__namespace__:${spec.local?.name}`);
          }
        }
      }
    }

    // Dynamic imports and require:
    // const sdk = await import("@tailor-platform/sdk")
    // const sdk = require("@tailor-platform/sdk")
    // const { createWorkflowJob } = await import("@tailor-platform/sdk")
    // const { createWorkflowJob } = require("@tailor-platform/sdk")
    if (nodeType === "VariableDeclaration") {
      const varDecl = node as unknown as VariableDeclaration;
      for (const decl of varDecl.declarations || []) {
        const init = unwrapAwait(decl.init);
        const source = getImportSource(init);

        if (source && isTailorSdkSource(source)) {
          const id = decl.id;

          // const sdk = await import(...) / const sdk = require(...)
          if (id?.type === "Identifier") {
            bindings.add(`__namespace__:${id.name}`);
          }
          // const { createWorkflowJob } = await import(...) / require(...)
          // const { createWorkflowJob: create } = await import(...) / require(...)
          else if (id?.type === "ObjectPattern") {
            const objPattern = id as unknown as ObjectPattern;
            for (const prop of objPattern.properties || []) {
              if (prop.type === "Property") {
                const bindingProp = prop as BindingProperty;
                const keyName =
                  bindingProp.key.type === "Identifier"
                    ? bindingProp.key.name
                    : (bindingProp.key as { value?: string }).value;
                if (keyName === "createWorkflowJob") {
                  const localName =
                    bindingProp.value.type === "Identifier"
                      ? bindingProp.value.name
                      : keyName;
                  bindings.add(localName ?? "");
                }
              }
            }
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      const child = node[key] as unknown;
      if (Array.isArray(child)) {
        child.forEach((c: unknown) => walk(c as ASTNode | null));
      } else if (child && typeof child === "object") {
        walk(child as ASTNode);
      }
    }
  }

  walk(program as unknown as ASTNode);
  return bindings;
}

/**
 * Check if a CallExpression is a createWorkflowJob call
 */
function isCreateWorkflowJobCall(
  node: ASTNode,
  bindings: Set<string>,
): node is ASTNode & { type: "CallExpression" } {
  if (node.type !== "CallExpression") return false;

  const callExpr = node as unknown as CallExpression;
  const callee = callExpr.callee;

  // Direct call: createWorkflowJob(...) or create(...)
  if (callee.type === "Identifier") {
    const identifier = callee as IdentifierReference;
    return bindings.has(identifier.name);
  }

  // Member access: sdk.createWorkflowJob(...)
  // Note: oxc uses MemberExpression with computed: false for static member access
  if (callee.type === "MemberExpression") {
    const memberExpr = callee as unknown as StaticMemberExpression;
    if (!memberExpr.computed) {
      const object = memberExpr.object;
      const property = memberExpr.property;
      if (
        object.type === "Identifier" &&
        bindings.has(`__namespace__:${(object as IdentifierReference).name}`) &&
        property.name === "createWorkflowJob"
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a node is a string literal
 */
function isStringLiteral(
  node: Expression | null | undefined,
): node is Expression & { type: "Literal"; value: string } {
  // Note: oxc uses "Literal" for all literals, distinguishing by value type
  return (
    node?.type === "Literal" &&
    typeof (node as { value?: unknown }).value === "string"
  );
}

/**
 * Check if a node is a function expression (arrow or regular)
 */
function isFunctionExpression(
  node: Expression | null | undefined,
): node is ArrowFunctionExpression | FunctionExpression {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression"
  );
}

interface FoundProperty {
  key: ObjectProperty["key"];
  value: Expression;
  start: number;
  end: number;
}

/**
 * Find a property in an object expression
 */
function findProperty(
  properties: ObjectPropertyKind[],
  name: string,
): FoundProperty | null {
  for (const prop of properties) {
    // Note: oxc uses "Property" for object properties
    if (prop.type === "Property") {
      const objProp = prop as ObjectProperty;
      const keyName =
        objProp.key.type === "Identifier"
          ? objProp.key.name
          : objProp.key.type === "Literal"
            ? (objProp.key as { value?: string }).value
            : null;
      if (keyName === name) {
        return {
          key: objProp.key,
          value: objProp.value,
          start: objProp.start,
          end: objProp.end,
        };
      }
    }
  }
  return null;
}

/**
 * Find all workflow jobs by detecting createWorkflowJob calls from @tailor-platform/sdk
 */
export function findAllJobs(
  program: Program,
  _sourceText: string,
): JobLocation[] {
  const jobs: JobLocation[] = [];
  const bindings = collectCreateWorkflowJobBindings(program);

  function walk(
    node: ASTNode | null | undefined,
    parents: ASTNode[] = [],
  ): void {
    if (!node || typeof node !== "object") return;

    // Detect createWorkflowJob(...) calls
    if (isCreateWorkflowJobCall(node, bindings)) {
      const callExpr = node as unknown as CallExpression;
      const args = callExpr.arguments;
      if (args?.length >= 1 && args[0]?.type === "ObjectExpression") {
        const configObj = args[0] as ObjectExpression;
        const nameProp = findProperty(configObj.properties, "name");
        const bodyProp = findProperty(configObj.properties, "body");
        const depsProp = findProperty(configObj.properties, "deps");

        if (
          nameProp &&
          isStringLiteral(nameProp.value) &&
          bodyProp &&
          isFunctionExpression(bodyProp.value)
        ) {
          // Find the outermost enclosing statement
          let statementRange: { start: number; end: number } | undefined;
          for (let i = 0; i < parents.length; i++) {
            const parent = parents[i];
            if (
              parent.type === "ExportNamedDeclaration" ||
              parent.type === "VariableDeclaration"
            ) {
              statementRange = {
                start: parent.start as number,
                end: parent.end as number,
              };
              break;
            }
          }

          jobs.push({
            name: nameProp.value.value,
            nameRange: { start: nameProp.start, end: nameProp.end },
            depsRange: depsProp
              ? { start: depsProp.start, end: depsProp.end }
              : undefined,
            bodyValueRange: {
              start: bodyProp.value.start,
              end: bodyProp.value.end,
            },
            statementRange,
          });
        }
      }
    }

    const newParents = [...parents, node];
    for (const key of Object.keys(node)) {
      const child = node[key] as unknown;
      if (Array.isArray(child)) {
        child.forEach((c: unknown) => walk(c as ASTNode | null, newParents));
      } else if (child && typeof child === "object") {
        walk(child as ASTNode, newParents);
      }
    }
  }

  walk(program as unknown as ASTNode);
  return jobs;
}

/**
 * Apply string replacements to source code
 * Replacements are applied from end to start to maintain positions
 */
function applyReplacements(
  source: string,
  replacements: Replacement[],
): string {
  const sorted = [...replacements].sort((a, b) => b.start - a.start);
  let result = source;
  for (const r of sorted) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }
  return result;
}

/**
 * Find the end position including trailing comma
 */
function findTrailingCommaEnd(source: string, position: number): number {
  let i = position;
  while (i < source.length) {
    const char = source[i];
    if (char === ",") return i + 1;
    if (!/\s/.test(char)) break;
    i++;
  }
  return position;
}

/**
 * Find the end of a statement including any trailing newline
 */
function findStatementEnd(source: string, position: number): number {
  let i = position;
  // Skip any trailing semicolons and whitespace on the same line
  while (
    i < source.length &&
    (source[i] === ";" || source[i] === " " || source[i] === "\t")
  ) {
    i++;
  }
  // Include the newline if present
  if (i < source.length && source[i] === "\n") {
    i++;
  }
  return i;
}

/**
 * Find variable declarations by export names
 * Returns a map of export name to statement range
 */
function findVariableDeclarationsByName(
  program: Program,
): Map<string, { start: number; end: number }> {
  const declarations = new Map<string, { start: number; end: number }>();

  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object") return;

    const nodeType = node.type as string | undefined;

    // Handle variable declarations: const job1 = ...
    // Only set if not already set (ExportNamedDeclaration is processed first and sets the outer range)
    if (nodeType === "VariableDeclaration") {
      const varDecl = node as unknown as VariableDeclaration;
      for (const decl of varDecl.declarations || []) {
        if (decl.id?.type === "Identifier" && decl.id.name) {
          if (!declarations.has(decl.id.name)) {
            declarations.set(decl.id.name, {
              start: varDecl.start,
              end: varDecl.end,
            });
          }
        }
      }
    }

    // Handle export declarations: export const job1 = ...
    if (nodeType === "ExportNamedDeclaration") {
      const exportDecl = node as unknown as ExportNamedDeclaration;
      const declaration = exportDecl.declaration;
      if (declaration?.type === "VariableDeclaration") {
        const varDecl = declaration as VariableDeclaration;
        for (const decl of varDecl.declarations || []) {
          if (decl.id?.type === "Identifier" && decl.id.name) {
            declarations.set(decl.id.name, {
              start: exportDecl.start,
              end: exportDecl.end,
            });
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      const child = node[key] as unknown;
      if (Array.isArray(child)) {
        child.forEach((c: unknown) => walk(c as ASTNode | null));
      } else if (child && typeof child === "object") {
        walk(child as ASTNode);
      }
    }
  }

  walk(program as unknown as ASTNode);
  return declarations;
}

/**
 * Transform workflow source code
 * - Target job: remove deps
 * - Other jobs: remove entire variable declaration
 *
 * @param source - The source code to transform
 * @param targetJobName - The name of the target job (from job config)
 * @param targetJobExportName - The export name of the target job (optional, for enhanced detection)
 * @param otherJobExportNames - Export names of other jobs to remove (optional, for enhanced detection)
 */
export function transformWorkflowSource(
  source: string,
  targetJobName: string,
  targetJobExportName?: string,
  otherJobExportNames?: string[],
): string {
  // Use .ts extension to properly parse TypeScript code
  const { program } = parseSync("input.ts", source);

  // Find all jobs using AST detection (for deps removal and fallback)
  const detectedJobs = findAllJobs(program, source);

  // Find all variable declarations for export name-based removal
  const allDeclarations = findVariableDeclarationsByName(program);

  const replacements: Replacement[] = [];
  const removedRanges = new Set<string>();

  // Helper to track removed ranges (avoid duplicate removals)
  const markRemoved = (start: number, end: number) => {
    removedRanges.add(`${start}-${end}`);
  };
  const isRemoved = (start: number, end: number) => {
    return removedRanges.has(`${start}-${end}`);
  };

  // Step 1: Process AST-detected jobs
  for (const job of detectedJobs) {
    if (job.name === targetJobName) {
      // Target job: remove deps
      if (job.depsRange) {
        replacements.push({
          start: job.depsRange.start,
          end: findTrailingCommaEnd(source, job.depsRange.end),
          text: "",
        });
      }
    } else {
      // Other jobs: remove entire variable declaration
      if (
        job.statementRange &&
        !isRemoved(job.statementRange.start, job.statementRange.end)
      ) {
        replacements.push({
          start: job.statementRange.start,
          end: findStatementEnd(source, job.statementRange.end),
          text: "",
        });
        markRemoved(job.statementRange.start, job.statementRange.end);
      } else if (!job.statementRange) {
        // Fallback: replace body with empty function if we can't find the statement
        replacements.push({
          start: job.bodyValueRange.start,
          end: job.bodyValueRange.end,
          text: "() => {}",
        });
      }
    }
  }

  // Step 2: Remove other jobs by export name (catches jobs missed by AST detection)
  if (otherJobExportNames) {
    for (const exportName of otherJobExportNames) {
      // Skip the target job's export name
      if (exportName === targetJobExportName) continue;

      const declRange = allDeclarations.get(exportName);
      if (declRange && !isRemoved(declRange.start, declRange.end)) {
        replacements.push({
          start: declRange.start,
          end: findStatementEnd(source, declRange.end),
          text: "",
        });
        markRemoved(declRange.start, declRange.end);
      }
    }
  }

  return applyReplacements(source, replacements);
}
