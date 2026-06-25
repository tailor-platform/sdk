import { parse, Lang } from "@ast-grep/napi";
import type { Edit, SgNode } from "@ast-grep/napi";

const SDK_MODULE = "@tailor-platform/sdk";

const RENAMES: Record<string, string> = {
  defineWaitPoint: "createWaitPoint",
  defineWaitPoints: "createWaitPoints",
};

function isInsideImportStatement(node: SgNode): boolean {
  let current: SgNode | null = node.parent();
  while (current) {
    if (current.kind() === "import_statement") return true;
    current = current.parent();
  }
  return false;
}

/**
 * Rename `defineWaitPoint` and `defineWaitPoints` imported from `@tailor-platform/sdk`
 * to `createWaitPoint` and `createWaitPoints`, updating both the import specifiers
 * and all usages in the file body.
 * @param source - File contents
 * @param filePath - Absolute path to the file (kept for the runner signature)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, _filePath?: string): string | null {
  const hasMatch = Object.keys(RENAMES).some((name) => source.includes(name));
  if (!hasMatch) return null;
  if (!source.includes(SDK_MODULE)) return null;

  const lang = source.includes("</") || source.includes("/>") ? Lang.Tsx : Lang.TypeScript;
  const root = parse(lang, source).root();

  const edits: Edit[] = [];
  // Non-aliased imports need their body references renamed too.
  const needsBodyRename = new Set<string>();

  const importStmts = root.findAll({
    rule: {
      kind: "import_statement",
      has: { kind: "string", regex: `^["']${SDK_MODULE}["']$` },
    },
  });

  for (const importStmt of importStmts) {
    const specs = importStmt.findAll({ rule: { kind: "import_specifier" } });
    for (const spec of specs) {
      const idents = spec.children().filter((c: SgNode) => c.kind() === "identifier");
      if (idents.length === 0) continue;

      const importedName = idents[0]!.text();
      const newName = RENAMES[importedName];
      if (!newName) continue;

      const isAliased = idents.length > 1;
      edits.push(idents[0]!.replace(newName));
      if (!isAliased) needsBodyRename.add(importedName);
    }
  }

  if (edits.length === 0) return null;

  if (needsBodyRename.size > 0) {
    // Skip body rename for any name that is also declared locally (function or variable),
    // to avoid incorrectly renaming shadowed identifiers unrelated to the SDK import.
    const localDecls = root.findAll({
      rule: { any: [{ kind: "function_declaration" }, { kind: "variable_declarator" }] },
    });
    for (const decl of localDecls) {
      if (isInsideImportStatement(decl)) continue;
      const nameChild = decl.children().find((c: SgNode) => c.kind() === "identifier");
      if (nameChild && needsBodyRename.has(nameChild.text())) {
        needsBodyRename.delete(nameChild.text());
      }
    }

    const identifiers = root.findAll({ rule: { kind: "identifier" } });
    for (const ident of identifiers) {
      const name = ident.text();
      if (!needsBodyRename.has(name)) continue;
      if (isInsideImportStatement(ident)) continue;
      edits.push(ident.replace(RENAMES[name]!));
    }
  }

  return root.commitEdits(edits);
}
