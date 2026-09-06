import {
  describeUnavailable,
  getNodeBuiltinMessage,
  isNodeBuiltinImport,
} from "@tailor-platform/shared/node-builtins";
import { type AstCallExpression, type AstNode, staticString } from "../lib/ast.js";
import { platformFunctionFactories, suggestsAlternatives } from "../lib/platform-functions.js";
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

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing Node built-in modules in files that define a resolver, executor, workflow job, or HTTP adapter.",
    },
    messages: {
      unavailable: "{{message}}",
    },
    schema: [],
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
        const typeOnlySpecifiers =
          node.specifiers.length > 0 && node.specifiers.every((specifier) => isTypeOnly(specifier));
        if (!isTypeOnly(node) && !typeOnlySpecifiers) addSource(node.source, node.source.value);
      },
      ExportNamedDeclaration: (node) => {
        if (node.source && !isTypeOnly(node)) addSource(node.source, node.source.value);
      },
      ExportAllDeclaration: (node) => {
        if (!isTypeOnly(node)) addSource(node.source, node.source.value);
      },
      ImportExpression: (node) => addSource(node.source, staticString(node.source)),
      CallExpression: (node) => calls.push(node),
      "Program:exit"() {
        const factories = platformFunctionFactories(imports, calls);
        if (factories.size === 0) return;
        const describe = suggestsAlternatives(factories)
          ? getNodeBuiltinMessage
          : describeUnavailable;
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
} satisfies Rule.RuleModule;

export default rule;
