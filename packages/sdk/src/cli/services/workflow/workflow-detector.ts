import { assertDefined } from "#/utils/assert";
import { isStringLiteral, findProperty } from "./ast-utils";
import { walkAst } from "./ast-walk";
import { collectSdkBindings, isSdkFunctionCall } from "./sdk-binding-collector";
import type { Program, CallExpression } from "@oxc-project/types";

export interface WorkflowLocation {
  name: string;
  exportName?: string;
  isDefaultExport?: boolean;
}

/**
 * Find all workflows by detecting createWorkflow calls from `@tailor-platform/sdk`
 * @param program - Parsed TypeScript program
 * @param _sourceText - Source code text (currently unused)
 * @returns Detected workflows
 */
export function findAllWorkflows(program: Program, _sourceText: string): WorkflowLocation[] {
  const workflows: WorkflowLocation[] = [];
  const bindings = collectSdkBindings(program, "createWorkflow");

  walkAst(program, (node, parents) => {
    // Detect createWorkflow(...) calls
    if (isSdkFunctionCall(node, bindings, "createWorkflow")) {
      const callExpr = node as unknown as CallExpression;
      const args = callExpr.arguments;
      const firstArg = args[0];
      if (args.length >= 1 && firstArg?.type === "ObjectExpression") {
        const configObj = assertDefined(firstArg, "createWorkflow first argument missing");
        const nameProp = findProperty(configObj.properties, "name");

        if (nameProp && isStringLiteral(nameProp.value)) {
          // Find export name from parent declarations
          let exportName: string | undefined;
          let isDefaultExport = false;
          for (let i = parents.length - 1; i >= 0; i--) {
            const parent = assertDefined(parents[i], `parent at index ${i} missing`);
            if (parent.type === "VariableDeclarator") {
              const declarator = parent as unknown as {
                id?: { type?: string; name?: string };
              };
              if (declarator.id?.type === "Identifier") {
                exportName = declarator.id.name;
                break;
              }
            }
            // Check for export default createWorkflow(...)
            if (parent.type === "ExportDefaultDeclaration") {
              isDefaultExport = true;
            }
          }

          workflows.push({
            name: nameProp.value.value,
            exportName,
            isDefaultExport,
          });
        }
      }
    }
  });
  return workflows;
}
