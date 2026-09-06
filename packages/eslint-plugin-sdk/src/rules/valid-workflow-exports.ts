import { type AstCallExpression, type AstNode, parentOf, unwrapExpression } from "../lib/ast.js";
import { configureImportTracker } from "../lib/sdk-bindings.js";
import { isInsideFunction } from "../lib/workflow.js";
import type { Rule } from "eslint";

type ModuleExports = Map<string, string[]>;

function moduleName(node: AstNode): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return null;
}

type AstProgram = Extract<AstNode, { type: "Program" }>;

function collectExports(program: AstProgram): ModuleExports {
  const exports: ModuleExports = new Map();
  const add = (local: string, exported: string) => {
    const names = exports.get(local) ?? [];
    names.push(exported);
    exports.set(local, names);
  };
  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      if (statement.declaration.type === "Identifier") add(statement.declaration.name, "default");
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    if ("exportKind" in statement && statement.exportKind === "type") continue;
    if (statement.declaration?.type === "VariableDeclaration") {
      for (const declarator of statement.declaration.declarations) {
        if (declarator.id.type === "Identifier") add(declarator.id.name, declarator.id.name);
      }
    }
    if (statement.source) continue;
    for (const specifier of statement.specifiers) {
      const local = moduleName(specifier.local);
      const exported = moduleName(specifier.exported);
      if (local !== null && exported !== null) add(local, exported);
    }
  }
  return exports;
}

function exportedNames(exports: ModuleExports, call: AstCallExpression): string[] {
  let node: AstNode = call;
  let parent = parentOf(node);
  while (parent !== null && unwrapExpression(parent) === node) {
    node = parent;
    parent = parentOf(parent);
  }
  if (parent?.type === "ExportDefaultDeclaration") return ["default"];
  if (
    parent?.type === "VariableDeclarator" &&
    parent.id.type === "Identifier" &&
    parent.init === node
  ) {
    return exports.get(parent.id.name) ?? [];
  }
  return [];
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require createWorkflow results to be the default export and createWorkflowJob results to be named exports.",
    },
    messages: {
      workflowNotDefault:
        "createWorkflow's result must be the module's default export (export default createWorkflow(...)); a workflow that is not default-exported is never deployed.",
      workflowNamedExport:
        "createWorkflow's result must not be a named export; the build treats named exports as workflow jobs and fails to load the file.",
      jobNotExported:
        "createWorkflowJob's result must be a named export (export const job = createWorkflowJob(...)); the build only collects jobs from named exports.",
      jobDefaultExport:
        "createWorkflowJob's result must not be the default export; the default export is reserved for createWorkflow's result, and the build fails to load the file.",
    },
    schema: [],
  },
  create(context) {
    const imports = configureImportTracker(context);
    const calls: AstCallExpression[] = [];

    return {
      ImportDeclaration: (node) => imports.track(node),
      CallExpression: (node) => calls.push(node),
      "Program:exit"(program) {
        const exports = collectExports(program);
        for (const call of calls) {
          const name = imports.callName(call);
          if (name !== "createWorkflow" && name !== "createWorkflowJob") continue;
          if (isInsideFunction(call)) continue;
          const names = exportedNames(exports, call);
          const isDefault = names.includes("default");
          if (name === "createWorkflow") {
            if (!isDefault) context.report({ node: call, messageId: "workflowNotDefault" });
            if (names.some((exported) => exported !== "default")) {
              context.report({ node: call, messageId: "workflowNamedExport" });
            }
            continue;
          }
          if (isDefault) {
            context.report({ node: call, messageId: "jobDefaultExport" });
          } else if (names.length === 0) {
            context.report({ node: call, messageId: "jobNotExported" });
          }
        }
      },
    };
  },
} satisfies Rule.RuleModule;

export default rule;
