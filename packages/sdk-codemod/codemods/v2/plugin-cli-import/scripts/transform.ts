import { parse, Lang } from "@ast-grep/napi";
import type { Edit, SgNode } from "@ast-grep/napi";

const CLI_MODULE = "@tailor-platform/sdk/cli";

/** Deprecated plugin re-exports from `@tailor-platform/sdk/cli` and their dedicated subpaths. */
const PLUGIN_SUBPATHS: Record<string, string> = {
  kyselyTypePlugin: "@tailor-platform/sdk/plugin/kysely-type",
  enumConstantsPlugin: "@tailor-platform/sdk/plugin/enum-constants",
  fileUtilsPlugin: "@tailor-platform/sdk/plugin/file-utils",
  seedPlugin: "@tailor-platform/sdk/plugin/seed",
};

interface ImportSpec {
  importedName: string;
  text: string;
}

function* iterateImportSpecs(importStmt: SgNode): Generator<ImportSpec> {
  const specs = importStmt.findAll({ rule: { kind: "import_specifier" } });
  for (const spec of specs) {
    const idents = spec.children().filter((c: SgNode) => c.kind() === "identifier");
    if (idents.length === 0) continue;
    yield { importedName: idents[0]!.text(), text: spec.text() };
  }
}

/** True for `import type { ... }` (statement-level `type`), not inline `{ type x }`. */
function isTypeOnlyImport(importStmt: SgNode): boolean {
  return importStmt.children().some((c: SgNode) => c.kind() === "type");
}

/** True when the import has a default binding or a `* as x` namespace binding. */
function hasNonNamedBinding(importStmt: SgNode): boolean {
  const clause = importStmt.children().find((c: SgNode) => c.kind() === "import_clause");
  if (!clause) return false;
  return clause
    .children()
    .some((c: SgNode) => c.kind() === "identifier" || c.kind() === "namespace_import");
}

/**
 * Rewrite deprecated plugin re-export imports from `@tailor-platform/sdk/cli`
 * to their dedicated plugin subpaths.
 *
 * Plugin specifiers are split into one `import { plugin } from "<subpath>"`
 * statement each; any non-plugin specifiers stay on the original `/cli`
 * import. A statement-level `import type` is carried over to every generated
 * line. `/cli` imports without plugin specifiers are left untouched.
 * @param source - File contents
 * @param filePath - Absolute path to the file (kept for the runner signature)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, _filePath?: string): string | null {
  if (!source.includes(CLI_MODULE)) return null;

  const lang = source.includes("</") || source.includes("/>") ? Lang.Tsx : Lang.TypeScript;
  const root = parse(lang, source).root();

  const edits: Edit[] = [];

  const importStmts = root.findAll({
    rule: {
      kind: "import_statement",
      has: { kind: "string", regex: `^["']${CLI_MODULE}["']$` },
    },
  });
  for (const importStmt of importStmts) {
    if (hasNonNamedBinding(importStmt)) continue;

    const keyword = isTypeOnlyImport(importStmt) ? "import type" : "import";

    const pluginSpecs: ImportSpec[] = [];
    const otherSpecs: ImportSpec[] = [];
    for (const spec of iterateImportSpecs(importStmt)) {
      (Object.hasOwn(PLUGIN_SUBPATHS, spec.importedName) ? pluginSpecs : otherSpecs).push(spec);
    }
    if (pluginSpecs.length === 0) continue;

    const lines = pluginSpecs
      .map((s) => `${keyword} { ${s.text} } from "${PLUGIN_SUBPATHS[s.importedName]}";`)
      .toSorted();
    if (otherSpecs.length > 0) {
      lines.unshift(
        `${keyword} { ${otherSpecs.map((s) => s.text).join(", ")} } from "${CLI_MODULE}";`,
      );
    }
    edits.push(importStmt.replace(lines.join("\n")));
  }

  if (edits.length === 0) return null;

  return root.commitEdits(edits);
}
