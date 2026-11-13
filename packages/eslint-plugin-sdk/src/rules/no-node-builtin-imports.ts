import { getNodeBuiltinMessage, isNodeBuiltinImport } from "@tailor-platform/shared/node-builtins";
import { type AstCallExpression, type AstNode, staticString } from "../lib/ast.js";
import { checkOptionSchema, unavailableDescriber } from "../lib/platform-functions.js";
import { configureImportTracker } from "../lib/sdk-bindings.js";
import type { Rule } from "eslint";

interface ModuleSource {
  node: AstNode;
  specifier: string;
}

function isTypeOnly(node: object): boolean {
  return (
    ("importKind" in node && node.importKind === "type") ||
    ("exportKind" in node && node.exportKind === "type")
  );
}

function isTypeOnlyDeclaration(node: { specifiers: readonly object[] }): boolean {
  return (
    isTypeOnly(node) ||
    (node.specifiers.length > 0 && node.specifiers.every((specifier) => isTypeOnly(specifier)))
  );
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow importing Node built-in modules in files that define a resolver, executor, workflow job, or HTTP adapter, or in every file with `check: "all-files"`.',
    },
    messages: {
      unavailable: "{{message}}",
    },
    schema: [checkOptionSchema],
  },
  create(context) {
    const imports = configureImportTracker(context);
    const calls: AstCallExpression[] = [];
    const sources: ModuleSource[] = [];
    const addSource = (node: AstNode, specifier: unknown) => {
      if (typeof specifier === "string") sources.push({ node, specifier });
    };

    return {
      ImportDeclaration: (node) => {
        imports.track(node);
        if (!isTypeOnlyDeclaration(node)) addSource(node.source, node.source.value);
      },
      ExportNamedDeclaration: (node) => {
        if (node.source && !isTypeOnlyDeclaration(node)) addSource(node.source, node.source.value);
      },
      ExportAllDeclaration: (node) => {
        if (!isTypeOnly(node)) addSource(node.source, node.source.value);
      },
      ImportExpression: (node) => addSource(node.source, staticString(node.source)),
      CallExpression: (node) => calls.push(node),
      "Program:exit"() {
        const describe = unavailableDescriber(context, imports, calls, getNodeBuiltinMessage);
        if (describe === null) return;
        for (const { node, specifier } of sources) {
          if (!isNodeBuiltinImport(specifier)) continue;
          context.report({
            node,
            messageId: "unavailable",
            data: { message: describe(specifier) },
          });
        }
      },
    };
  },
};

export default rule;
