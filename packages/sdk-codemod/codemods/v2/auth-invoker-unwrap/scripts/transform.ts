import { parse, Lang } from "@ast-grep/napi";
import type { Edit, SgNode } from "@ast-grep/napi";

const QUICK_FILTER_NEEDLES = ["auth.invoker", "authInvoker"];

function quickFilter(source: string): boolean {
  return QUICK_FILTER_NEEDLES.some((needle) => source.includes(needle));
}

function isInsideImportStatement(node: SgNode): boolean {
  let current: SgNode | null = node.parent();
  while (current) {
    if (current.kind() === "import_statement") return true;
    current = current.parent();
  }
  return false;
}

interface InvokerCall {
  /** The full `auth.invoker(...)` call expression node. */
  callNode: SgNode;
  /** The string literal argument node, including its surrounding quotes. */
  argText: string;
  /** Byte range covered by this call expression. */
  range: [number, number];
}

/**
 * Find every `auth.invoker(<stringLiteral>)` call in `root`. Calls whose
 * argument is not a literal string (e.g. `auth.invoker(name)`,
 * `auth.invoker(\`x\${y}\`)`) are intentionally ignored: only the literal form
 * is safely replaceable.
 */
function findInvokerCalls(root: SgNode): InvokerCall[] {
  const matches = root.findAll({ rule: { pattern: "auth.invoker($NAME)" } });
  const out: InvokerCall[] = [];
  for (const match of matches) {
    const arg = match.getMatch("NAME");
    if (!arg) continue;
    if (arg.kind() !== "string") continue;
    const r = match.range();
    out.push({ callNode: match, argText: arg.text(), range: [r.start.index, r.end.index] });
  }
  return out;
}

/**
 * Count `auth` identifier references that are not part of an import statement
 * and not part of any of the `auth.invoker(...)` calls already scheduled for
 * replacement. A non-zero return means the `auth` import must be preserved.
 */
function countRemainingAuthRefs(
  root: SgNode,
  scheduledCallRanges: Array<[number, number]>,
): number {
  const idents = root.findAll({ rule: { kind: "identifier", regex: "^auth$" } });
  let count = 0;
  for (const node of idents) {
    if (isInsideImportStatement(node)) continue;
    const r = node.range();
    const start = r.start.index;
    const inScheduled = scheduledCallRanges.some(([s, e]) => start >= s && start < e);
    if (inScheduled) continue;
    count++;
  }
  return count;
}

interface ImportSpec {
  spec: SgNode;
  importedName: string;
  localName: string;
}

function* iterateImportSpecs(importStmt: SgNode): Generator<ImportSpec> {
  const specs = importStmt.findAll({ rule: { kind: "import_specifier" } });
  for (const spec of specs) {
    const idents = spec.children().filter((c: SgNode) => c.kind() === "identifier");
    if (idents.length === 0) continue;
    const importedName = idents[0]!.text();
    const aliasNode = idents[1];
    yield {
      spec,
      importedName,
      localName: aliasNode?.text() ?? importedName,
    };
  }
}

/**
 * Build an Edit that removes the `auth` specifier from `importStmt`. Returns
 * null if the statement does not import `auth`. When `auth` is the only
 * specifier the entire import line is removed (including a trailing newline);
 * otherwise just the `auth,` / `, auth` fragment is dropped.
 */
function buildAuthImportRemovalEdit(source: string, importStmt: SgNode): Edit | null {
  const specs = Array.from(iterateImportSpecs(importStmt));
  const authSpec = specs.find((s) => s.localName === "auth" && s.importedName === "auth");
  if (!authSpec) return null;

  if (specs.length === 1) {
    const r = importStmt.range();
    let end = r.end.index;
    while (end < source.length && (source[end] === "\n" || source[end] === "\r")) end++;
    return {
      startPos: r.start.index,
      endPos: end,
      insertedText: "",
    };
  }

  const r = authSpec.spec.range();
  let start = r.start.index;
  let end = r.end.index;
  // Eat one neighbor `,` (and adjacent whitespace) so the resulting list stays
  // syntactically valid.
  while (end < source.length && (source[end] === " " || source[end] === "\t")) end++;
  if (source[end] === ",") {
    end++;
    while (end < source.length && (source[end] === " " || source[end] === "\t")) end++;
    return { startPos: start, endPos: end, insertedText: "" };
  }
  while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
  if (source[start - 1] === ",") {
    start--;
    while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
    return { startPos: start, endPos: end, insertedText: "" };
  }
  return { startPos: r.start.index, endPos: r.end.index, insertedText: "" };
}

function findAuthImports(root: SgNode): SgNode[] {
  const stmts = root.findAll({ rule: { kind: "import_statement" } });
  return stmts.filter((stmt) => {
    for (const { localName, importedName } of iterateImportSpecs(stmt)) {
      if (localName === "auth" && importedName === "auth") return true;
    }
    return false;
  });
}

function findAuthInvokerShorthands(root: SgNode): SgNode[] {
  return root.findAll({
    rule: {
      kind: "shorthand_property_identifier",
      regex: "^authInvoker$",
    },
  });
}

/**
 * Replace `auth.invoker("name")` calls with the bare `"name"` string literal
 * and rename `authInvoker:` option keys to `invoker:`.
 * If no other `auth` references remain after the rewrite, drop the `auth`
 * specifier (or the entire import line when `auth` was its sole specifier).
 *
 * `auth.invoker()` was removed in favor of passing the machine user name
 * directly to `invoker`; carrying the `auth` import only for `.invoker()`
 * would otherwise pull config-layer modules into runtime bundles.
 * @param source - File contents
 * @param filePath - Absolute path to the file (kept for the runner signature)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, _filePath: string): string | null {
  if (!quickFilter(source)) return null;

  const lang = source.includes("</") || source.includes("/>") ? Lang.Tsx : Lang.TypeScript;
  const root = parse(lang, source).root();

  const calls = findInvokerCalls(root);
  const edits: Edit[] = calls.map((c) => c.callNode.replace(c.argText));
  edits.push(
    ...findAuthInvokerShorthands(root).map((node) => node.replace("invoker: authInvoker")),
  );

  if (
    calls.length > 0 &&
    countRemainingAuthRefs(
      root,
      calls.map((c) => c.range),
    ) === 0
  ) {
    for (const importStmt of findAuthImports(root)) {
      const edit = buildAuthImportRemovalEdit(source, importStmt);
      if (edit) edits.push(edit);
    }
  }

  let result = edits.length === 0 ? source : root.commitEdits(edits);

  result = result.replace(/\bauthInvoker(\s*):/g, "invoker$1:");

  // Normalize: drop the leading blank line that an import removal at the top
  // of the file leaves behind, and collapse runs of 3+ newlines.
  result = result.replace(/^[\t ]*\n+/, "").replace(/\n{3,}/g, "\n\n");

  return result === source ? null : result;
}
