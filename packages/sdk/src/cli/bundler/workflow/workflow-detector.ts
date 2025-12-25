import { type ASTNode, isStringLiteral, findProperty } from "./ast-utils";
import { collectSdkBindings, isSdkFunctionCall } from "./sdk-binding-collector";
import type {
  Program,
  CallExpression,
  ObjectExpression,
  ImportDeclaration,
  ImportDefaultSpecifier,
} from "@oxc-project/types";

export interface WorkflowLocation {
  name: string;
  exportName?: string;
  isDefaultExport?: boolean;
}

/**
 * Find all workflows by detecting createWorkflow calls from \@tailor-platform/sdk
 */
export function findAllWorkflows(program: Program, _sourceText: string): WorkflowLocation[] {
  const workflows: WorkflowLocation[] = [];
  const bindings = collectSdkBindings(program, "createWorkflow");

  function walk(node: ASTNode | null | undefined, parents: ASTNode[] = []): void {
    if (!node || typeof node !== "object") return;

    // Detect createWorkflow(...) calls
    if (isSdkFunctionCall(node, bindings, "createWorkflow")) {
      const callExpr = node as unknown as CallExpression;
      const args = callExpr.arguments;
      if (args?.length >= 1 && args[0]?.type === "ObjectExpression") {
        const configObj = args[0] as ObjectExpression;
        const nameProp = findProperty(configObj.properties, "name");

        if (nameProp && isStringLiteral(nameProp.value)) {
          // Find export name from parent declarations
          let exportName: string | undefined;
          let isDefaultExport = false;
          for (let i = parents.length - 1; i >= 0; i--) {
            const parent = parents[i];
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
  return workflows;
}

/**
 * Build a map from export name to workflow name from detected workflows
 */
export function buildWorkflowNameMap(workflows: WorkflowLocation[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const workflow of workflows) {
    if (workflow.exportName) {
      map.set(workflow.exportName, workflow.name);
    }
  }
  return map;
}

/**
 * Detect default imports in a source file and return a map from local name to import source
 */
export function detectDefaultImports(program: Program): Map<string, string> {
  const imports = new Map<string, string>();

  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object") return;

    const nodeType = node.type as string | undefined;

    if (nodeType === "ImportDeclaration") {
      const importDecl = node as unknown as ImportDeclaration;
      const source = importDecl.source?.value;

      if (typeof source === "string") {
        for (const specifier of importDecl.specifiers || []) {
          // import foo from "module"
          if (specifier.type === "ImportDefaultSpecifier") {
            const spec = specifier as ImportDefaultSpecifier;
            if (spec.local?.name) {
              imports.set(spec.local.name, source);
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
  return imports;
}
