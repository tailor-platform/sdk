import type { SgNode } from "@ast-grep/napi";

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
