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
  exportName?: string;
  nameRange: { start: number; end: number };
  bodyValueRange: { start: number; end: number };
  // Range of the entire variable declaration statement (for removal)
  statementRange?: { start: number; end: number };
}

interface TriggerCall {
  identifierName: string;
  callRange: { start: number; end: number };
  argsText: string;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

/**
 * Check if a module source is from \@tailor-platform/sdk (including subpaths)
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
 * Collect all import bindings for createWorkflowJob from \@tailor-platform/sdk
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
 * Find all workflow jobs by detecting createWorkflowJob calls from \@tailor-platform/sdk
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

        if (
          nameProp &&
          isStringLiteral(nameProp.value) &&
          bodyProp &&
          isFunctionExpression(bodyProp.value)
        ) {
          // Find the outermost enclosing statement and export name
          // Iterate from closest parent (end of array) to farthest (start of array)
          let statementRange: { start: number; end: number } | undefined;
          let exportName: string | undefined;
          for (let i = parents.length - 1; i >= 0; i--) {
            const parent = parents[i];
            if (parent.type === "VariableDeclarator") {
              const declarator = parent as unknown as {
                id?: { type?: string; name?: string };
              };
              if (declarator.id?.type === "Identifier") {
                exportName = declarator.id.name;
              }
            }
            // Keep track of the outermost statement (ExportNamedDeclaration > VariableDeclaration)
            if (
              parent.type === "ExportNamedDeclaration" ||
              parent.type === "VariableDeclaration"
            ) {
              statementRange = {
                start: parent.start as number,
                end: parent.end as number,
              };
              // Don't break - continue to find ExportNamedDeclaration if it exists
            }
          }

          jobs.push({
            name: nameProp.value.value,
            exportName,
            nameRange: { start: nameProp.start, end: nameProp.end },
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
 * Detect all .trigger() calls in the source code
 * Returns information about each trigger call for transformation
 */
export function detectTriggerCalls(
  program: Program,
  sourceText: string,
): TriggerCall[] {
  const calls: TriggerCall[] = [];

  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object") return;

    // Detect pattern: identifier.trigger(args)
    if (node.type === "CallExpression") {
      const callExpr = node as unknown as CallExpression;
      const callee = callExpr.callee;

      if (callee.type === "MemberExpression") {
        const memberExpr = callee as unknown as StaticMemberExpression;
        if (
          !memberExpr.computed &&
          memberExpr.object.type === "Identifier" &&
          memberExpr.property.name === "trigger"
        ) {
          const identifierName = (memberExpr.object as IdentifierReference)
            .name;

          // Extract arguments text
          let argsText = "";
          if (callExpr.arguments.length > 0) {
            const firstArg = callExpr.arguments[0];
            const lastArg = callExpr.arguments[callExpr.arguments.length - 1];
            if (
              firstArg &&
              lastArg &&
              "start" in firstArg &&
              "end" in lastArg
            ) {
              argsText = sourceText.slice(
                firstArg.start as number,
                lastArg.end as number,
              );
            }
          }

          calls.push({
            identifierName,
            callRange: { start: callExpr.start, end: callExpr.end },
            argsText,
          });
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
  return calls;
}

/**
 * Build a map from export name to job name from detected jobs
 */
export function buildJobNameMap(jobs: JobLocation[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const job of jobs) {
    if (job.exportName) {
      map.set(job.exportName, job.name);
    }
  }
  return map;
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
 * - Transform .trigger() calls to tailor.workflow.triggerJobFunction()
 * - Other jobs: remove entire variable declaration
 *
 * @param source - The source code to transform
 * @param targetJobName - The name of the target job (from job config)
 * @param targetJobExportName - The export name of the target job (optional, for enhanced detection)
 * @param otherJobExportNames - Export names of other jobs to remove (optional, for enhanced detection)
 * @param allJobsMap - Map from export name to job name for trigger transformation (optional)
 */
export function transformWorkflowSource(
  source: string,
  targetJobName: string,
  targetJobExportName?: string,
  otherJobExportNames?: string[],
  allJobsMap?: Map<string, string>,
): string {
  // Use .ts extension to properly parse TypeScript code
  const { program } = parseSync("input.ts", source);

  // Find all jobs using AST detection
  const detectedJobs = findAllJobs(program, source);

  // Build job name map from detected jobs if not provided
  const jobNameMap = allJobsMap ?? buildJobNameMap(detectedJobs);

  // Find all variable declarations for export name-based removal
  const allDeclarations = findVariableDeclarationsByName(program);

  // Detect all .trigger() calls
  const triggerCalls = detectTriggerCalls(program, source);

  const replacements: Replacement[] = [];
  const removedRanges: Array<{ start: number; end: number }> = [];

  // Helper to check if a position is inside any removed range
  const isInsideRemovedRange = (pos: number) => {
    return removedRanges.some((r) => pos >= r.start && pos < r.end);
  };

  // Helper to track removed ranges (avoid duplicate/overlapping removals)
  // Use start position only for comparison since end position may vary due to findStatementEnd
  const isAlreadyMarkedForRemoval = (start: number) => {
    return removedRanges.some((r) => r.start === start);
  };

  // Step 1: First, collect all ranges that will be removed (other job declarations)
  // This must happen before trigger transformation to know which trigger calls to skip
  for (const job of detectedJobs) {
    if (job.name === targetJobName) {
      continue;
    }

    if (
      job.statementRange &&
      !isAlreadyMarkedForRemoval(job.statementRange.start)
    ) {
      const endPos = findStatementEnd(source, job.statementRange.end);
      removedRanges.push({ start: job.statementRange.start, end: endPos });
      replacements.push({
        start: job.statementRange.start,
        end: endPos,
        text: "",
      });
    } else if (!job.statementRange) {
      // Fallback: replace body with empty function if we can't find the statement
      replacements.push({
        start: job.bodyValueRange.start,
        end: job.bodyValueRange.end,
        text: "() => {}",
      });
    }
  }

  // Step 2: Remove other jobs by export name (catches jobs missed by AST detection)
  if (otherJobExportNames) {
    for (const exportName of otherJobExportNames) {
      if (exportName === targetJobExportName) continue;

      const declRange = allDeclarations.get(exportName);
      if (declRange && !isAlreadyMarkedForRemoval(declRange.start)) {
        const endPos = findStatementEnd(source, declRange.end);
        removedRanges.push({ start: declRange.start, end: endPos });
        replacements.push({
          start: declRange.start,
          end: endPos,
          text: "",
        });
      }
    }
  }

  // Step 3: Transform .trigger() calls to tailor.workflow.triggerJobFunction()
  // Only transform trigger calls that are NOT inside ranges being removed
  for (const call of triggerCalls) {
    // Skip trigger calls inside removed job declarations
    if (isInsideRemovedRange(call.callRange.start)) {
      continue;
    }

    const jobName = jobNameMap.get(call.identifierName);
    if (jobName) {
      const transformedCall = `tailor.workflow.triggerJobFunction("${jobName}", ${call.argsText || "undefined"})`;
      replacements.push({
        start: call.callRange.start,
        end: call.callRange.end,
        text: transformedCall,
      });
    }
  }

  return applyReplacements(source, replacements);
}
