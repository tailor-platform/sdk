import type { SgNode } from "@ast-grep/napi";

/**
 * Distinguish intrinsic JSX tag names from references to JavaScript bindings.
 * @param node - Identifier considered for renaming
 * @returns Whether this identifier names a lowercase JSX element
 */
export function isIntrinsicJsxName(node: SgNode): boolean {
  const parentKind = node.parent()?.kind();
  return (
    /^[a-z]/.test(node.text()) &&
    (parentKind === "jsx_opening_element" ||
      parentKind === "jsx_closing_element" ||
      parentKind === "jsx_self_closing_element")
  );
}

/**
 * Detect TypeScript value declarations and namespace exports that make a rename ambiguous.
 * @param root - Parsed source file
 * @param name - Name that must remain unambiguous
 * @returns Whether a declaration or namespace export uses the name
 */
export function hasTypeScriptName(root: SgNode, name: string): boolean {
  for (const node of root.findAll({
    rule: {
      any: [
        { kind: "enum_declaration" },
        { kind: "internal_module" },
        { kind: "import_alias" },
        { kind: "import_require_clause" },
        { kind: "namespace_export" },
        { kind: "function_expression" },
        { kind: "generator_function" },
        { kind: "generator_function_declaration" },
        { kind: "class" },
      ],
    },
  })) {
    const binding =
      node.field("name") ?? node.children().find((child) => child.kind() === "identifier");
    if (binding?.text() === name) return true;
  }
  return false;
}

/**
 * Identify a conventional Tailor config module for config-only export migration.
 * @param filePath - Source path supplied by the codemod runner
 * @returns Whether the file is a Tailor config module
 */
export function isTailorConfigPath(filePath: string): boolean {
  return /(?:^|[/\\])tailor\.config\.[cm]?[jt]sx?$/.test(filePath);
}
