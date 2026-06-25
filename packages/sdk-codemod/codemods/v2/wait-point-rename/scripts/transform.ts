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
    // Build byte-range maps for scopes where each name is shadowed by a local declaration.
    // Only identifiers outside these ranges should be renamed.
    const shadowedRanges = new Map<string, Array<{ start: number; end: number }>>();

    const localDecls = root.findAll({
      rule: { any: [{ kind: "function_declaration" }, { kind: "variable_declarator" }] },
    });
    for (const decl of localDecls) {
      if (isInsideImportStatement(decl)) continue;
      const nameChild = decl.children().find((c: SgNode) => c.kind() === "identifier");
      if (!nameChild || !needsBodyRename.has(nameChild.text())) continue;

      // Walk up to the nearest statement_block or program — that is the scope
      // where this declaration shadows the imported name.
      let scopeNode: SgNode = root;
      let p: SgNode | null = decl.parent();
      while (p) {
        if (p.kind() === "statement_block" || p.kind() === "program") {
          scopeNode = p;
          break;
        }
        p = p.parent();
      }

      const r = scopeNode.range();
      const name = nameChild.text();
      if (!shadowedRanges.has(name)) shadowedRanges.set(name, []);
      shadowedRanges.get(name)!.push({ start: r.start.index, end: r.end.index });
    }

    const identifiers = root.findAll({ rule: { kind: "identifier" } });
    for (const ident of identifiers) {
      const name = ident.text();
      if (!needsBodyRename.has(name)) continue;
      if (isInsideImportStatement(ident)) continue;

      // Skip identifiers that fall inside a scope where this name is locally declared.
      const ranges = shadowedRanges.get(name);
      if (ranges) {
        const pos = ident.range().start.index;
        if (ranges.some((r) => pos >= r.start && pos <= r.end)) continue;
      }

      edits.push(ident.replace(RENAMES[name]!));
    }
  }

  return root.commitEdits(edits);
}
