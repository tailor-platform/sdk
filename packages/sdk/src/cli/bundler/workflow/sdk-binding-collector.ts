import { type ASTNode, isTailorSdkSource, getImportSource, unwrapAwait } from "./ast-utils";
import type {
  Program,
  ImportDeclaration,
  VariableDeclaration,
  ImportSpecifier,
  ImportDefaultSpecifier,
  ImportNamespaceSpecifier,
  ObjectPattern,
  BindingProperty,
  CallExpression,
  StaticMemberExpression,
  IdentifierReference,
} from "@oxc-project/types";

/**
 * Collect all import bindings for a specific function from the Tailor SDK package
 * Returns a Set of local names that refer to the function
 * @param {Program} program - Parsed TypeScript program
 * @param {string} functionName - Function name to collect bindings for
 * @returns {Set<string>} Set of local names bound to the SDK function
 */
export function collectSdkBindings(program: Program, functionName: string): Set<string> {
  const bindings = new Set<string>();

  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object") return;

    const nodeType = node.type as string | undefined;

    // Static imports: import { createWorkflowJob } from "@tailor-platform/sdk"
    if (nodeType === "ImportDeclaration") {
      const importDecl = node as unknown as ImportDeclaration;
      const source = importDecl.source?.value;
      if (typeof source === "string" && isTailorSdkSource(source)) {
        for (const specifier of importDecl.specifiers || []) {
          // import { createWorkflowJob } from "@tailor-platform/sdk"
          // import { createWorkflowJob as create } from "@tailor-platform/sdk"
          if (specifier.type === "ImportSpecifier") {
            const importSpec = specifier as ImportSpecifier;
            const imported =
              importSpec.imported.type === "Identifier"
                ? importSpec.imported.name
                : (importSpec.imported as { value?: string }).value;
            if (imported === functionName) {
              bindings.add(importSpec.local?.name || imported);
            }
          }
          // import sdk from "@tailor-platform/sdk" → sdk.createWorkflowJob
          // import * as sdk from "@tailor-platform/sdk" → sdk.createWorkflowJob
          else if (
            specifier.type === "ImportDefaultSpecifier" ||
            specifier.type === "ImportNamespaceSpecifier"
          ) {
            const spec = specifier as ImportDefaultSpecifier | ImportNamespaceSpecifier;
            // Store namespace/default with special prefix to track member access
            bindings.add(`__namespace__:${spec.local?.name}`);
          }
        }
      }
    }

    // Dynamic imports and require:
    // const sdk = await import("@tailor-platform/sdk")
    // const sdk = require("@tailor-platform/sdk")
    // const { createWorkflowJob } = await import("@tailor-platform/sdk")
    // const { createWorkflowJob } = require("@tailor-platform/sdk")
    if (nodeType === "VariableDeclaration") {
      const varDecl = node as unknown as VariableDeclaration;
      for (const decl of varDecl.declarations || []) {
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
            const objPattern = id as unknown as ObjectPattern;
            for (const prop of objPattern.properties || []) {
              if (prop.type === "Property") {
                const bindingProp = prop as BindingProperty;
                const keyName =
                  bindingProp.key.type === "Identifier"
                    ? bindingProp.key.name
                    : (bindingProp.key as { value?: string }).value;
                if (keyName === functionName) {
                  const localName =
                    bindingProp.value.type === "Identifier" ? bindingProp.value.name : keyName;
                  bindings.add(localName ?? "");
                }
              }
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
  return bindings;
}

/**
 * Check if a CallExpression is a call to a specific SDK function
 * @param {ASTNode} node - AST node to inspect
 * @param {Set<string>} bindings - Collected SDK bindings
 * @param {string} functionName - SDK function name
 * @returns {node is ASTNode & { type: "CallExpression" }} True if node is a call to the SDK function
 */
export function isSdkFunctionCall(
  node: ASTNode,
  bindings: Set<string>,
  functionName: string,
): node is ASTNode & { type: "CallExpression" } {
  if (node.type !== "CallExpression") return false;

  const callExpr = node as unknown as CallExpression;
  const callee = callExpr.callee;

  // Direct call: createWorkflowJob(...) or create(...)
  if (callee.type === "Identifier") {
    const identifier = callee as IdentifierReference;
    return bindings.has(identifier.name);
  }

  // Member access: sdk.createWorkflowJob(...)
  // Note: oxc uses MemberExpression with computed: false for static member access
  if (callee.type === "MemberExpression") {
    const memberExpr = callee as unknown as StaticMemberExpression;
    if (!memberExpr.computed) {
      const object = memberExpr.object;
      const property = memberExpr.property;
      if (
        object.type === "Identifier" &&
        bindings.has(`__namespace__:${(object as IdentifierReference).name}`) &&
        property.name === functionName
      ) {
        return true;
      }
    }
  }

  return false;
}
