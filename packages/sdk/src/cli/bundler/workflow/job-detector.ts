import { type ASTNode, isStringLiteral, isFunctionExpression, findProperty } from "./ast-utils";
import { collectSdkBindings, isSdkFunctionCall } from "./sdk-binding-collector";
import type {
  Program,
  CallExpression,
  ObjectExpression,
  StaticMemberExpression,
  IdentifierReference,
  AwaitExpression,
} from "@oxc-project/types";

export interface JobLocation {
  name: string;
  exportName?: string;
  nameRange: { start: number; end: number };
  bodyValueRange: { start: number; end: number };
  // Range of the entire variable declaration statement (for removal)
  statementRange?: { start: number; end: number };
}

export interface TriggerCall {
  identifierName: string;
  callRange: { start: number; end: number };
  argsText: string;
  // If true, the call is wrapped in an await expression
  hasAwait: boolean;
  // The range including the await keyword (if present)
  fullRange: { start: number; end: number };
}

/**
 * Find all workflow jobs by detecting createWorkflowJob calls from \@tailor-platform/sdk
 * @param program - Parsed TypeScript program
 * @param _sourceText - Source code text (currently unused)
 * @returns Detected job locations
 */
export function findAllJobs(program: Program, _sourceText: string): JobLocation[] {
  const jobs: JobLocation[] = [];
  const bindings = collectSdkBindings(program, "createWorkflowJob");

  function walk(node: ASTNode | null | undefined, parents: ASTNode[] = []): void {
    if (!node || typeof node !== "object") return;

    // Detect createWorkflowJob(...) calls
    if (isSdkFunctionCall(node, bindings, "createWorkflowJob")) {
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
            if (parent.type === "ExportNamedDeclaration" || parent.type === "VariableDeclaration") {
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
 * Build a map from export name to job name from detected jobs
 * @param jobs - Detected job locations
 * @returns Map from export name to job name
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
 * Detect all .trigger() calls in the source code
 * Returns information about each trigger call for transformation
 * @param program - Parsed TypeScript program
 * @param sourceText - Source code text
 * @returns Detected trigger calls
 */
export function detectTriggerCalls(program: Program, sourceText: string): TriggerCall[] {
  const calls: TriggerCall[] = [];

  function walk(node: ASTNode | null | undefined, parent: ASTNode | null = null): void {
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
          const identifierName = (memberExpr.object as IdentifierReference).name;

          // Extract arguments text
          let argsText = "";
          if (callExpr.arguments.length > 0) {
            const firstArg = callExpr.arguments[0];
            const lastArg = callExpr.arguments[callExpr.arguments.length - 1];
            if (firstArg && lastArg && "start" in firstArg && "end" in lastArg) {
              argsText = sourceText.slice(firstArg.start as number, lastArg.end as number);
            }
          }

          // Check if this call is wrapped in an await expression
          // triggerJobFunction is synchronous, so we need to remove await
          const hasAwait = parent?.type === "AwaitExpression";
          const awaitExpr = hasAwait ? (parent as unknown as AwaitExpression) : null;

          const callRange = { start: callExpr.start, end: callExpr.end };
          const fullRange = awaitExpr ? { start: awaitExpr.start, end: awaitExpr.end } : callRange;

          calls.push({
            identifierName,
            callRange,
            argsText,
            hasAwait,
            fullRange,
          });
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
