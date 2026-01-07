import { parseSync } from "oxc-parser";
import { type ASTNode, type Replacement, applyReplacements, resolvePath } from "./ast-utils";
import { detectDefaultImports } from "./workflow-detector";
import type {
  Program,
  CallExpression,
  ObjectExpression,
  ObjectProperty,
  StaticMemberExpression,
  IdentifierReference,
  AwaitExpression,
} from "@oxc-project/types";

interface AuthInvokerInfo {
  isShorthand: boolean;
  valueText: string;
}

interface ExtendedTriggerCall {
  kind: "job" | "workflow";
  identifierName: string;
  callRange: { start: number; end: number };
  argsText: string;
  // For workflow triggers, extracted authInvoker info from config
  authInvoker?: AuthInvokerInfo;
  // If true, the call is wrapped in an await expression that should be removed
  hasAwait?: boolean;
  // The range including the await keyword (if present)
  fullRange?: { start: number; end: number };
}

/**
 * Extract authInvoker info from a config object expression
 * Returns the authInvoker value text and whether it's a shorthand property
 * @param {unknown} configArg - Config argument node
 * @param {string} sourceText - Source code text
 * @returns {AuthInvokerInfo | undefined} Extracted authInvoker info, if any
 */
function extractAuthInvokerInfo(
  configArg: unknown,
  sourceText: string,
): AuthInvokerInfo | undefined {
  if (!configArg || typeof configArg !== "object") return undefined;

  const arg = configArg as { type?: string };
  if (arg.type !== "ObjectExpression") return undefined;

  const objExpr = configArg as ObjectExpression;

  // Find authInvoker property
  for (const prop of objExpr.properties) {
    if (prop.type !== "Property") continue;

    const objProp = prop as ObjectProperty;
    const keyName =
      objProp.key.type === "Identifier"
        ? objProp.key.name
        : objProp.key.type === "Literal"
          ? (objProp.key as { value?: string }).value
          : null;

    if (keyName === "authInvoker") {
      if (objProp.shorthand) {
        return { isShorthand: true, valueText: "authInvoker" };
      }
      // Extract value text directly from source
      const valueText = sourceText.slice(objProp.value.start, objProp.value.end);
      return { isShorthand: false, valueText };
    }
  }

  return undefined;
}

/**
 * Detect .trigger() calls for known workflows and jobs
 * Only detects calls where the identifier is in workflowNames or jobNames
 * @param {Program} program - The parsed AST program
 * @param {string} sourceText - The source code text
 * @param {Set<string>} workflowNames - Set of known workflow identifier names
 * @param {Set<string>} jobNames - Set of known job identifier names
 * @returns {ExtendedTriggerCall[]} Detected trigger call metadata
 */
function detectExtendedTriggerCalls(
  program: Program,
  sourceText: string,
  workflowNames: Set<string>,
  jobNames: Set<string>,
): ExtendedTriggerCall[] {
  const calls: ExtendedTriggerCall[] = [];

  function walk(node: ASTNode | null | undefined, parent: ASTNode | null = null): void {
    if (!node || typeof node !== "object") return;

    // Detect pattern: identifier.trigger(args) or identifier.trigger(args, config)
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
          const identifierName = (memberExpr.object as IdentifierReference).name;

          // Only process if this is a known workflow or job
          const isWorkflow = workflowNames.has(identifierName);
          const isJob = jobNames.has(identifierName);
          if (!isWorkflow && !isJob) {
            // Skip unknown identifiers to prevent false positives
            return;
          }

          const argCount = callExpr.arguments.length;

          // Extract first argument text
          let argsText = "";
          if (argCount > 0) {
            const firstArg = callExpr.arguments[0];
            if (firstArg && "start" in firstArg && "end" in firstArg) {
              argsText = sourceText.slice(firstArg.start as number, firstArg.end as number);
            }
          }

          // Check if this call is wrapped in an await expression
          // For job triggers, we need to remove the await since triggerJobFunction is synchronous
          const hasAwait = parent?.type === "AwaitExpression";
          const awaitExpr = hasAwait ? (parent as unknown as AwaitExpression) : null;

          // Determine kind based on known identifier type
          if (isWorkflow && argCount >= 2) {
            // Workflow trigger requires 2 arguments (args, config)
            const secondArg = callExpr.arguments[1];
            // Extract authInvoker directly from the config object
            const authInvoker = extractAuthInvokerInfo(secondArg, sourceText);
            if (authInvoker) {
              calls.push({
                kind: "workflow",
                identifierName,
                callRange: { start: callExpr.start, end: callExpr.end },
                argsText,
                authInvoker,
                // workflow.trigger uses async triggerWorkflow, so keep await
                hasAwait: false,
              });
            }
          } else if (isJob) {
            // Job trigger (0-1 arguments)
            // triggerJobFunction is synchronous, so we need to remove await
            calls.push({
              kind: "job",
              identifierName,
              callRange: { start: callExpr.start, end: callExpr.end },
              argsText,
              hasAwait,
              fullRange: awaitExpr ? { start: awaitExpr.start, end: awaitExpr.end } : undefined,
            });
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      const child = node[key] as unknown;
      if (Array.isArray(child)) {
        child.forEach((c: unknown) => walk(c as ASTNode | null, node));
      } else if (child && typeof child === "object") {
        walk(child as ASTNode, node);
      }
    }
  }

  walk(program as unknown as ASTNode);
  return calls;
}

/**
 * Transform trigger calls for resolver/executor/workflow functions
 * Handles both job.trigger() and workflow.trigger() calls
 * @param {string} source - The source code to transform
 * @param {Map<string, string>} workflowNameMap - Map from variable name to workflow name
 * @param {Map<string, string>} jobNameMap - Map from variable name to job name
 * @param {Map<string, string>} [workflowFileMap] - Map from file path (without extension) to workflow name for default exports
 * @param {string} [currentFilePath] - Path of the current file being transformed (for resolving relative imports)
 * @returns {string} Transformed source code with trigger calls rewritten
 */
export function transformFunctionTriggers(
  source: string,
  workflowNameMap: Map<string, string>,
  jobNameMap: Map<string, string>,
  workflowFileMap?: Map<string, string>,
  currentFilePath?: string,
): string {
  const { program } = parseSync("input.ts", source);

  // Build a map from local identifier name to workflow name
  // This includes both named exports (from workflowNameMap) and default imports (resolved via workflowFileMap)
  const localWorkflowNameMap = new Map(workflowNameMap);

  if (workflowFileMap && currentFilePath) {
    // Detect default imports and resolve them to workflow names
    const defaultImports = detectDefaultImports(program);
    const currentDir = currentFilePath.replace(/[/\\][^/\\]+$/, "");

    for (const [localName, importSource] of defaultImports) {
      // Skip non-relative imports
      if (!importSource.startsWith(".")) continue;

      // Resolve the import path relative to the current file
      const resolvedPath = resolvePath(currentDir, importSource);
      const workflowName = workflowFileMap.get(resolvedPath);
      if (workflowName) {
        localWorkflowNameMap.set(localName, workflowName);
      }
    }
  }

  // Build sets of known workflow and job identifier names for filtering
  const workflowNames = new Set(localWorkflowNameMap.keys());
  const jobNames = new Set(jobNameMap.keys());

  // Detect trigger calls only for known workflows and jobs
  const triggerCalls = detectExtendedTriggerCalls(program, source, workflowNames, jobNames);

  const replacements: Replacement[] = [];

  for (const call of triggerCalls) {
    if (call.kind === "workflow" && call.authInvoker) {
      // Workflow trigger - get workflow name from map
      const workflowName = localWorkflowNameMap.get(call.identifierName);
      if (workflowName) {
        // Use authInvoker info extracted during detection
        const authInvokerExpr = call.authInvoker.isShorthand
          ? "authInvoker"
          : call.authInvoker.valueText;
        // Transform to tailor.workflow.triggerWorkflow
        const transformedCall = `tailor.workflow.triggerWorkflow("${workflowName}", ${call.argsText || "undefined"}, { authInvoker: ${authInvokerExpr} })`;
        replacements.push({
          start: call.callRange.start,
          end: call.callRange.end,
          text: transformedCall,
        });
      }
    } else if (call.kind === "job") {
      // Job trigger - get job name from map
      const jobName = jobNameMap.get(call.identifierName);
      if (jobName) {
        // Transform to tailor.workflow.triggerJobFunction
        // triggerJobFunction is synchronous, so we remove await if present
        const transformedCall = `tailor.workflow.triggerJobFunction("${jobName}", ${call.argsText || "undefined"})`;

        // If the call was wrapped in await, replace the entire await expression
        // Otherwise just replace the call
        const range = call.hasAwait && call.fullRange ? call.fullRange : call.callRange;
        replacements.push({
          start: range.start,
          end: range.end,
          text: transformedCall,
        });
      }
    }
  }

  return applyReplacements(source, replacements);
}
