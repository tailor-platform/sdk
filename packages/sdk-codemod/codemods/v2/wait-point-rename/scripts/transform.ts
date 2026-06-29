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

    const addShadowedRange = (name: string, scopeNode: SgNode) => {
      const r = scopeNode.range();
      if (!shadowedRanges.has(name)) shadowedRanges.set(name, []);
      shadowedRanges.get(name)!.push({ start: r.start.index, end: r.end.index });
    };

    // Variable declarations and local function declarations.
    const localDecls = root.findAll({
      rule: { any: [{ kind: "function_declaration" }, { kind: "variable_declarator" }] },
    });
    for (const decl of localDecls) {
      if (isInsideImportStatement(decl)) continue;
      // For variable_declarator: check direct identifier bindings and shorthand
      // destructuring patterns (const { x } = ...) — both create local shadows.
      const nameChild =
        decl
          .children()
          .filter((c: SgNode) => c.kind() === "identifier")
          .find((c: SgNode) => needsBodyRename.has(c.text())) ??
        decl
          .children()
          .find((c: SgNode) => c.kind() === "object_pattern")
          ?.children()
          .find(
            (c: SgNode) =>
              c.kind() === "shorthand_property_identifier_pattern" && needsBodyRename.has(c.text()),
          );
      if (!nameChild || !needsBodyRename.has(nameChild.text())) continue;

      // Walk up to the nearest statement_block or program — that is the scope
      // where this declaration shadows the imported name.
      let scopeNode: SgNode = root;
      let p: SgNode | null = decl.parent();
      while (p) {
        const k = p.kind();
        if (
          k === "statement_block" ||
          k === "program" ||
          k === "for_statement" ||
          k === "for_in_statement"
        ) {
          scopeNode = p;
          break;
        }
        p = p.parent();
      }

      addShadowedRange(nameChild.text(), scopeNode);
    }

    // Function/arrow parameters — covers required (param: T) and optional (param?: T).
    const paramNodes = root.findAll({
      rule: { any: [{ kind: "required_parameter" }, { kind: "optional_parameter" }] },
    });
    for (const param of paramNodes) {
      if (isInsideImportStatement(param)) continue;
      // The name identifier may be a direct child or wrapped in rest_pattern.
      const nameChild = param
        .children()
        .flatMap((c: SgNode) =>
          c.kind() === "rest_pattern"
            ? c.children().filter((cc: SgNode) => cc.kind() === "identifier")
            : c.kind() === "identifier"
              ? [c]
              : [],
        )
        .find((c: SgNode) => needsBodyRename.has(c.text()));
      if (!nameChild) continue;

      // Walk up past formal_parameters to the enclosing function/arrow, then use its body.
      let scopeNode: SgNode = root;
      let p: SgNode | null = param.parent();
      while (p) {
        const k = p.kind();
        if (k === "formal_parameters") {
          p = p.parent();
          continue;
        }
        if (
          k === "function_declaration" ||
          k === "function_expression" ||
          k === "arrow_function" ||
          k === "method_definition"
        ) {
          // Use the whole function node so the parameter list itself is also covered.
          scopeNode = p;
          break;
        }
        break;
      }

      addShadowedRange(nameChild.text(), scopeNode);
    }

    // for...of / for...in binding identifiers (direct children of for_in_statement,
    // appearing before the 'of' or 'in' keyword).
    const forInStmts = root.findAll({ rule: { kind: "for_in_statement" } });
    for (const stmt of forInStmts) {
      const children = stmt.children();
      const keywordIdx = children.findIndex((c: SgNode) => c.kind() === "of" || c.kind() === "in");
      if (keywordIdx < 0) continue;
      for (let i = 0; i < keywordIdx; i++) {
        const child = children[i]!;
        if (child.kind() === "identifier" && needsBodyRename.has(child.text())) {
          addShadowedRange(child.text(), stmt);
        }
      }
    }

    const renameNode = (node: SgNode) => {
      const name = node.text();
      if (!needsBodyRename.has(name)) return;
      if (isInsideImportStatement(node)) return;
      const ranges = shadowedRanges.get(name);
      if (ranges) {
        const pos = node.range().start.index;
        if (ranges.some((r) => pos >= r.start && pos < r.end)) return;
      }
      edits.push(node.replace(RENAMES[name]!));
    };

    for (const ident of root.findAll({ rule: { kind: "identifier" } })) {
      renameNode(ident);
    }
    // Shorthand property references in object literals ({ defineWaitPoints }) use a
    // distinct AST node kind and must be renamed separately.
    for (const prop of root.findAll({ rule: { kind: "shorthand_property_identifier" } })) {
      renameNode(prop);
    }
  }

  return root.commitEdits(edits);
}
