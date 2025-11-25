import { parseSync } from "oxc-parser";

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
function getImportSource(node: any): string | null {
  // await import("@tailor-platform/sdk")
  if (node?.type === "ImportExpression") {
    const source = node.source;
    if (source?.type === "StringLiteral" || source?.type === "Literal") {
      return source.value;
    }
  }
  // require("@tailor-platform/sdk")
  if (
    node?.type === "CallExpression" &&
    node.callee?.type === "Identifier" &&
    node.callee.name === "require"
  ) {
    const arg = node.arguments?.[0];
    if (arg?.type === "StringLiteral" || arg?.type === "Literal") {
      return arg.value;
    }
  }
  return null;
}

/**
 * Unwrap AwaitExpression to get the inner expression
 */
function unwrapAwait(node: any): any {
  if (node?.type === "AwaitExpression") {
    return node.argument;
  }
  return node;
}

/**
 * Collect all import bindings for createWorkflowJob from @tailor-platform/sdk
 * Returns a Set of local names that refer to createWorkflowJob
 */
function collectCreateWorkflowJobBindings(program: any): Set<string> {
  const bindings = new Set<string>();

  function walk(node: any): void {
    if (!node || typeof node !== "object") return;

    // Static imports: import { createWorkflowJob } from "@tailor-platform/sdk"
    if (node.type === "ImportDeclaration") {
      const source = node.source?.value;
      if (source && isTailorSdkSource(source)) {
        for (const specifier of node.specifiers || []) {
          // import { createWorkflowJob } from "@tailor-platform/sdk"
          // import { createWorkflowJob as create } from "@tailor-platform/sdk"
          if (specifier.type === "ImportSpecifier") {
            const imported =
              specifier.imported?.name || specifier.imported?.value;
            if (imported === "createWorkflowJob") {
              bindings.add(specifier.local?.name || imported);
            }
          }
          // import sdk from "@tailor-platform/sdk" → sdk.createWorkflowJob
          // import * as sdk from "@tailor-platform/sdk" → sdk.createWorkflowJob
          else if (
            specifier.type === "ImportDefaultSpecifier" ||
            specifier.type === "ImportNamespaceSpecifier"
          ) {
            // Store namespace/default with special prefix to track member access
            bindings.add(`__namespace__:${specifier.local?.name}`);
          }
        }
      }
    }

    // Dynamic imports and require:
    // const sdk = await import("@tailor-platform/sdk")
    // const sdk = require("@tailor-platform/sdk")
    // const { createWorkflowJob } = await import("@tailor-platform/sdk")
    // const { createWorkflowJob } = require("@tailor-platform/sdk")
    if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations || []) {
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
            for (const prop of id.properties || []) {
              if (prop.type === "ObjectProperty" || prop.type === "Property") {
                const keyName = prop.key?.name || prop.key?.value;
                if (keyName === "createWorkflowJob") {
                  const localName = prop.value?.name || keyName;
                  bindings.add(localName);
                }
              }
            }
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((c) => walk(c));
      } else if (child && typeof child === "object") {
        walk(child);
      }
    }
  }

  walk(program);
  return bindings;
}

/**
 * Check if a CallExpression is a createWorkflowJob call
 */
function isCreateWorkflowJobCall(node: any, bindings: Set<string>): boolean {
  if (node.type !== "CallExpression") return false;

  const callee = node.callee;

  // Direct call: createWorkflowJob(...) or create(...)
  if (callee?.type === "Identifier") {
    return bindings.has(callee.name);
  }

  // Member access: sdk.createWorkflowJob(...)
  if (
    callee?.type === "StaticMemberExpression" ||
    callee?.type === "MemberExpression"
  ) {
    const object = callee.object;
    const property = callee.property;
    if (
      object?.type === "Identifier" &&
      bindings.has(`__namespace__:${object.name}`) &&
      property?.name === "createWorkflowJob"
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a node is a string literal
 */
function isStringLiteral(node: any): boolean {
  return node?.type === "StringLiteral" || node?.type === "Literal";
}

/**
 * Check if a node is a function expression (arrow or regular)
 */
function isFunctionExpression(node: any): boolean {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression"
  );
}

/**
 * Find a property in an object expression
 */
function findProperty(
  properties: any[],
  name: string,
): { key: any; value: any; start: number; end: number } | null {
  for (const prop of properties) {
    if (prop.type === "ObjectProperty" || prop.type === "Property") {
      const keyName =
        prop.key?.type === "Identifier"
          ? prop.key.name
          : prop.key?.type === "StringLiteral" || prop.key?.type === "Literal"
            ? prop.key.value
            : null;
      if (keyName === name) {
        return {
          key: prop.key,
          value: prop.value,
          start: prop.start,
          end: prop.end,
        };
      }
    }
  }
  return null;
}

/**
 * Find all workflow jobs by detecting createWorkflowJob calls from @tailor-platform/sdk
 */
export function findAllJobs(program: any, _sourceText: string): JobLocation[] {
  const jobs: JobLocation[] = [];
  const bindings = collectCreateWorkflowJobBindings(program);

  function walk(node: any, parents: any[] = []): void {
    if (!node || typeof node !== "object") return;

    // Detect createWorkflowJob(...) calls
    if (isCreateWorkflowJobCall(node, bindings)) {
      const args = node.arguments;
      if (args?.length >= 1 && args[0]?.type === "ObjectExpression") {
        const configObj = args[0];
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
              statementRange = { start: parent.start, end: parent.end };
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
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((c) => walk(c, newParents));
      } else if (child && typeof child === "object") {
        walk(child, newParents);
      }
    }
  }

  walk(program);
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
  program: any,
): Map<string, { start: number; end: number }> {
  const declarations = new Map<string, { start: number; end: number }>();

  function walk(node: any): void {
    if (!node || typeof node !== "object") return;

    // Handle variable declarations: const job1 = ...
    // Only set if not already set (ExportNamedDeclaration is processed first and sets the outer range)
    if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations || []) {
        if (decl.id?.type === "Identifier" && decl.id.name) {
          if (!declarations.has(decl.id.name)) {
            declarations.set(decl.id.name, {
              start: node.start,
              end: node.end,
            });
          }
        }
      }
    }

    // Handle export declarations: export const job1 = ...
    if (node.type === "ExportNamedDeclaration" && node.declaration) {
      const declaration = node.declaration;
      if (declaration.type === "VariableDeclaration") {
        for (const decl of declaration.declarations || []) {
          if (decl.id?.type === "Identifier" && decl.id.name) {
            declarations.set(decl.id.name, {
              start: node.start,
              end: node.end,
            });
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((c) => walk(c));
      } else if (child && typeof child === "object") {
        walk(child);
      }
    }
  }

  walk(program);
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
