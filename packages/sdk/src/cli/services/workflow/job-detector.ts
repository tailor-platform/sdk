import { assertDefined } from "#/utils/assert";
import { type ASTNode, isStringLiteral, isFunctionExpression, findProperty } from "./ast-utils";
import { collectSdkBindings, isSdkFunctionCall } from "./sdk-binding-collector";
import type { Program, CallExpression, ObjectExpression } from "@oxc-project/types";

export interface JobLocation {
  name: string;
  exportName?: string;
  nameRange: { start: number; end: number };
  bodyValueRange: { start: number; end: number };
  // Range of the entire variable declaration statement (for removal)
  statementRange?: { start: number; end: number };
}

/**
 * Find all workflow jobs by detecting createWorkflowJob calls from `@tailor-platform/sdk`
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
      const firstArg = args[0];
      if (args.length >= 1 && firstArg?.type === "ObjectExpression") {
        const configObj = assertDefined(
          firstArg,
          "createWorkflowJob first argument missing",
        ) as ObjectExpression;
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
            const parent = assertDefined(parents[i], `parent at index ${i} missing`);
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
