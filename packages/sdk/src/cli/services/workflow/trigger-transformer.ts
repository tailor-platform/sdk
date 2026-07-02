import { parseSync } from "oxc-parser";
import {
  type ASTNode,
  type Replacement,
  applyReplacements,
  findStatementEnd,
  resolvePath,
} from "./ast-utils";
import { detectDefaultImports } from "./workflow-detector";
import type {
  Program,
  CallExpression,
  StaticMemberExpression,
  IdentifierReference,
  ImportDeclaration,
  ImportDefaultSpecifier,
} from "@oxc-project/types";

interface ExtendedTriggerCall {
  kind: "job" | "workflow";
  identifierName: string;
  callRange: { start: number; end: number };
  argsText: string;
  // For workflow triggers, source text of the options argument if present
  optionsText?: string;
}

/**
 * Name of the injected runtime normalizer helper. Chosen to be unique enough
 * to avoid collisions with user code.
 */
const NORMALIZER_IDENTIFIER = "__tailor_normalizeTriggerOptions";

/**
 * Build the source text of the injected normalizer helper.
 *
 * Expands a plain-string `authInvoker` (machine user name) in the trigger
 * options to the object form `{ namespace, machineUserName }`; any other
 * options value passes through unchanged. The auth namespace is baked in at
 * bundle time.
 * @param authNamespace - Auth service namespace to embed
 * @returns Source line defining the helper
 */
function buildNormalizerHelperSource(authNamespace: string): string {
  return `const ${NORMALIZER_IDENTIFIER} = (o) => o && typeof o.authInvoker === "string" ? { ...o, authInvoker: { namespace: ${JSON.stringify(authNamespace)}, machineUserName: o.authInvoker } } : o;\n`;
}

/**
 * Extract the source text of a call argument, if present.
 * @param arg - Argument node, possibly absent
 * @param sourceText - Source code text
 * @returns Source text of the argument, or undefined when absent
 */
function argumentSourceText(arg: unknown, sourceText: string): string | undefined {
  if (arg && typeof arg === "object" && "start" in arg && "end" in arg) {
    return sourceText.slice(arg.start as number, arg.end as number);
  }
  return undefined;
}

/**
 * Check if an AST binding pattern (parameter, catch clause, etc.) contains an Identifier with the given name.
 * @param node - AST node to inspect
 * @param name - Identifier name to look for
 * @returns True if the binding pattern contains the name
 */
function containsBindingName(node: ASTNode | null | undefined, name: string): boolean {
  if (!node || typeof node !== "object") return false;
  if (
    (node as { type?: string }).type === "Identifier" &&
    (node as { name?: string }).name === name
  )
    return true;
  for (const key of Object.keys(node)) {
    const child = node[key] as unknown;
    if (Array.isArray(child)) {
      if (child.some((c) => containsBindingName(c as ASTNode, name))) return true;
    } else if (child && typeof child === "object") {
      if (containsBindingName(child as ASTNode, name)) return true;
    }
  }
  return false;
}

/**
 * Build a map of reference counts for multiple identifiers in a single AST pass.
 * Scope-aware: references inside functions or catch clauses that shadow the name
 * via parameters are excluded, so only references to the original import binding
 * are counted.
 * Excludes import declarations and property names in non-computed member expressions.
 * @param program - The parsed AST program
 * @param names - Set of identifier names to count
 * @returns Map from identifier name to reference count
 */
function buildReferenceCountMap(program: Program, names: Set<string>): Map<string, number> {
  if (names.size === 0) return new Map();

  const counts = new Map<string, number>();
  const shadowDepth = new Map<string, number>();
  for (const name of names) {
    counts.set(name, 0);
    shadowDepth.set(name, 0);
  }

  function walk(node: ASTNode | null | undefined, parentNode?: ASTNode, parentKey?: string): void {
    if (!node || typeof node !== "object") return;

    const nodeType = (node as { type?: string }).type;

    if (nodeType === "ImportDeclaration") return;

    // Track scope shadowing from function/catch parameters
    const shadowedHere: string[] = [];
    if (
      nodeType === "FunctionDeclaration" ||
      nodeType === "FunctionExpression" ||
      nodeType === "ArrowFunctionExpression"
    ) {
      const params = (node as { params?: unknown[] }).params;
      if (params) {
        for (const name of names) {
          if (params.some((p) => containsBindingName(p as ASTNode, name))) {
            shadowDepth.set(name, (shadowDepth.get(name) ?? 0) + 1);
            shadowedHere.push(name);
          }
        }
      }
    }
    if (nodeType === "CatchClause") {
      const param = (node as { param?: unknown }).param;
      if (param) {
        for (const name of names) {
          if (containsBindingName(param as ASTNode, name)) {
            shadowDepth.set(name, (shadowDepth.get(name) ?? 0) + 1);
            shadowedHere.push(name);
          }
        }
      }
    }

    if (nodeType === "Identifier") {
      const identName = (node as { name?: string }).name;
      if (identName && names.has(identName) && (shadowDepth.get(identName) ?? 0) === 0) {
        const isMemberProperty =
          parentNode &&
          (parentNode as { type?: string }).type === "MemberExpression" &&
          parentKey === "property" &&
          !(parentNode as { computed?: boolean }).computed;
        const isObjectPropertyKey =
          parentNode &&
          (parentNode as { type?: string }).type === "Property" &&
          parentKey === "key" &&
          !(parentNode as { shorthand?: boolean }).shorthand &&
          !(parentNode as { computed?: boolean }).computed;

        if (!isMemberProperty && !isObjectPropertyKey) {
          counts.set(identName, (counts.get(identName) ?? 0) + 1);
        }
      }
    }

    for (const key of Object.keys(node)) {
      const child = node[key] as unknown;
      if (Array.isArray(child)) {
        child.forEach((c: unknown) => walk(c as ASTNode | null, node, key));
      } else if (child && typeof child === "object") {
        walk(child as ASTNode, node, key);
      }
    }

    for (const name of shadowedHere) {
      shadowDepth.set(name, (shadowDepth.get(name) ?? 0) - 1);
    }
  }

  walk(program as unknown as ASTNode);
  return counts;
}

interface ImportRemovalRange {
  start: number;
  end: number;
  /** True when the entire import declaration should be removed (including trailing newline). */
  isFullDeclaration: boolean;
}

/**
 * Find the text range to remove for a dead default import.
 *
 * - Default-only import (`import wf from "..."`): returns the full declaration range.
 * - Mixed import (`import wf, { helper } from "..."`): returns the range covering
 *   the default specifier and trailing comma/whitespace so the result becomes
 *   `import { helper } from "..."`.
 * @param program - The parsed AST program
 * @param localName - The local name of the default import
 * @param source - The source code text (used to locate the `{` in mixed imports)
 * @returns Range to remove, or null if the import was not found
 */
function findDefaultImportRemovalRange(
  program: Program,
  localName: string,
  source: string,
): ImportRemovalRange | null {
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;

    const importDecl = statement as unknown as ImportDeclaration;
    const specifiers = importDecl.specifiers;

    for (const spec of specifiers) {
      if (spec.type !== "ImportDefaultSpecifier") continue;

      const defaultSpec = spec as ImportDefaultSpecifier;
      if (defaultSpec.local.name !== localName) continue;

      if (specifiers.length === 1) {
        return { start: importDecl.start, end: importDecl.end, isFullDeclaration: true };
      }

      // Mixed import: remove "wf, " up to the "{" so the result is "import { ... } from ..."
      const braceIndex = source.indexOf("{", defaultSpec.end);
      if (braceIndex !== -1) {
        return { start: defaultSpec.start, end: braceIndex, isFullDeclaration: false };
      }
      return null;
    }
  }

  return null;
}

/**
 * Detect .trigger() calls for known workflows and jobs
 * Only detects calls where the identifier is in workflowNames or jobNames
 * @param program - The parsed AST program
 * @param sourceText - The source code text
 * @param workflowNames - Set of known workflow identifier names
 * @param jobNames - Set of known job identifier names
 * @returns Detected trigger call metadata
 */
function detectExtendedTriggerCalls(
  program: Program,
  sourceText: string,
  workflowNames: Set<string>,
  jobNames: Set<string>,
): ExtendedTriggerCall[] {
  const calls: ExtendedTriggerCall[] = [];

  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object") return;

    // Detect pattern: identifier.trigger(args) or identifier.trigger(args, config)
    if (node.type === "CallExpression") {
      const callExpr = node as unknown as CallExpression;
      const callee = callExpr.callee;

      if (callee.type === "MemberExpression") {
        const memberExpr = callee as unknown as StaticMemberExpression;

        // callee may be a ComputedMemberExpression at runtime
        // oxlint-disable typescript/no-unnecessary-condition
        const identifierName =
          !memberExpr.computed && memberExpr.object.type === "Identifier"
            ? (memberExpr.object as IdentifierReference).name
            : null;
        const propertyName = !memberExpr.computed ? memberExpr.property.name : null;
        // oxlint-enable typescript/no-unnecessary-condition

        if (identifierName && propertyName === "trigger") {
          const isWorkflow = workflowNames.has(identifierName);
          const isJob = jobNames.has(identifierName);
          if (isWorkflow || isJob) {
            const argsText = argumentSourceText(callExpr.arguments[0], sourceText) ?? "";

            if (isWorkflow) {
              const optionsText = argumentSourceText(callExpr.arguments[1], sourceText);
              calls.push({
                kind: "workflow",
                identifierName,
                callRange: { start: callExpr.start, end: callExpr.end },
                argsText,
                optionsText,
              });
            } else if (isJob) {
              calls.push({
                kind: "job",
                identifierName,
                callRange: { start: callExpr.start, end: callExpr.end },
                argsText,
              });
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
  return calls;
}

/**
 * Transform trigger calls for resolver/executor/workflow functions
 * Handles job.trigger() and workflow.trigger() calls
 * @param source - The source code to transform
 * @param workflowNameMap - Map from variable name to workflow name
 * @param jobNameMap - Map from variable name to job name
 * @param workflowFileMap - Map from file path (without extension) to workflow name for default exports
 * @param currentFilePath - Path of the current file being transformed (for resolving relative imports)
 * @param authNamespace - Auth service namespace used to expand string-literal `authInvoker` to object form
 * @returns Transformed source code with trigger calls rewritten
 */
export function transformFunctionTriggers(
  source: string,
  workflowNameMap: Map<string, string>,
  jobNameMap: Map<string, string>,
  workflowFileMap?: Map<string, string>,
  currentFilePath?: string,
  authNamespace?: string,
): string {
  const { program } = parseSync("input.ts", source);

  // Build a map from local identifier name to workflow name
  // This includes both named exports (from workflowNameMap) and default imports (resolved via workflowFileMap)
  const localWorkflowNameMap = new Map(workflowNameMap);

  // Track which default imports resolved to workflows (candidates for dead import removal)
  const workflowDefaultImportNames = new Set<string>();

  if (workflowFileMap && currentFilePath) {
    // Detect default imports and resolve them to workflow names
    const defaultImports = detectDefaultImports(program);
    const currentDir = currentFilePath.replace(/[/\\][^/\\]+$/, "");

    for (const [localName, importSource] of defaultImports) {
      // Skip non-relative imports
      if (!importSource.startsWith(".")) continue;

      // Resolve the import path relative to the current file. Strip a trailing
      // extension (e.g. `./simple.mjs` from a `.mts` source) so it can match
      // workflowFileMap keys, which are stored without extensions.
      const resolvedPath = resolvePath(currentDir, importSource).replace(
        /\.(ts|mts|cts|js|mjs|cjs)$/,
        "",
      );
      const workflowName = workflowFileMap.get(resolvedPath);
      if (workflowName) {
        localWorkflowNameMap.set(localName, workflowName);
        workflowDefaultImportNames.add(localName);
      }
    }
  }

  // Build sets of known workflow and job identifier names for filtering
  const workflowNames = new Set(localWorkflowNameMap.keys());
  const jobNames = new Set(jobNameMap.keys());

  // Detect trigger calls only for known workflows and jobs.
  // When trigger calls nest, keep only the outermost one: the outer
  // replacement text is built from the original source, so applying an inner
  // replacement as well would corrupt the output.
  const allTriggerCalls = detectExtendedTriggerCalls(program, source, workflowNames, jobNames);
  const triggerCalls = allTriggerCalls.filter(
    (call) =>
      !allTriggerCalls.some(
        (other) =>
          other !== call &&
          other.callRange.start <= call.callRange.start &&
          call.callRange.end <= other.callRange.end,
      ),
  );

  const replacements: Replacement[] = [];
  // Whether any workflow trigger authInvoker was wrapped with the runtime
  // normalizer. Used to decide whether to inject the helper at the top.
  let needsNormalizerHelper = false;

  // Track how many trigger calls were transformed per identifier (for dead import detection)
  const transformedCallsPerIdentifier = new Map<string, number>();

  for (const call of triggerCalls) {
    if (call.kind === "workflow") {
      // Workflow trigger - get workflow name from map
      const workflowName = localWorkflowNameMap.get(call.identifierName);
      if (workflowName) {
        // Wrap the options with the runtime normalizer so a string-form
        // authInvoker in any options shape (object literal, variable
        // reference, spread) becomes the object form the platform RPC
        // expects. The normalizer is injected once at the top of the file.
        // When no auth service is configured we can't expand a string, so
        // we pass through unchanged (platform will reject a string with a
        // clear error).
        let optionsPart = "";
        if (call.optionsText !== undefined) {
          if (authNamespace) {
            optionsPart = `, ${NORMALIZER_IDENTIFIER}(${call.optionsText})`;
            needsNormalizerHelper = true;
          } else {
            optionsPart = `, ${call.optionsText}`;
          }
        }
        // Transform to tailor.workflow.triggerWorkflow
        const transformedCall = `tailor.workflow.triggerWorkflow("${workflowName}", ${call.argsText || "undefined"}${optionsPart})`;
        replacements.push({
          start: call.callRange.start,
          end: call.callRange.end,
          text: transformedCall,
        });
        transformedCallsPerIdentifier.set(
          call.identifierName,
          (transformedCallsPerIdentifier.get(call.identifierName) ?? 0) + 1,
        );
      }
    } else {
      const jobName = jobNameMap.get(call.identifierName);
      if (jobName) {
        const transformedCall = `(async () => tailor.workflow.triggerJobFunction("${jobName}", ${call.argsText || "undefined"}))()`;

        replacements.push({
          start: call.callRange.start,
          end: call.callRange.end,
          text: transformedCall,
        });
        transformedCallsPerIdentifier.set(
          call.identifierName,
          (transformedCallsPerIdentifier.get(call.identifierName) ?? 0) + 1,
        );
      }
    }
  }

  // Remove default import declarations that became dead after trigger transformation.
  // A default import is dead when it has no remaining references, either because
  // it was already unused or because all references to its local identifier were
  // .trigger() calls that have been rewritten above.
  // Single AST pass for all candidate names; scope-aware to ignore shadowed references.
  const refCounts = buildReferenceCountMap(program, workflowDefaultImportNames);

  for (const localName of workflowDefaultImportNames) {
    const transformedCount = transformedCallsPerIdentifier.get(localName) ?? 0;
    const refCount = refCounts.get(localName) ?? 0;

    if (refCount === 0 || transformedCount >= refCount) {
      const removal = findDefaultImportRemovalRange(program, localName, source);
      if (removal) {
        replacements.push({
          start: removal.start,
          end: removal.isFullDeclaration ? findStatementEnd(source, removal.end) : removal.end,
          text: "",
        });
      }
    }
  }

  const transformed = applyReplacements(source, replacements);

  // Inject the normalizer helper at the top of the file if we referenced it.
  // Each module gets its own copy; rolldown keeps module scopes separate so
  // there is no cross-module naming conflict.
  if (needsNormalizerHelper && authNamespace) {
    return buildNormalizerHelperSource(authNamespace) + transformed;
  }

  return transformed;
}
