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

function sameRange(a: SgNode, b: SgNode): boolean {
  const ar = a.range();
  const br = b.range();
  return ar.start.index === br.start.index && ar.end.index === br.end.index;
}

function keyText(node: SgNode | null): string | null {
  if (!node) return null;
  return node.text().replace(/^['"]|['"]$/g, "");
}

function expressionArguments(args: SgNode): SgNode[] {
  return args.children().filter((child) => !["(", ")", ","].includes(child.kind()));
}

function argumentCallForObject(objectNode: SgNode): { call: SgNode; index: number } | null {
  const args = objectNode.parent();
  const call = args?.parent();
  if (args?.kind() !== "arguments" || call?.kind() !== "call_expression") return null;
  const index = expressionArguments(args).findIndex((arg) => sameRange(arg, objectNode));
  return index === -1 ? null : { call, index };
}

function calleeText(call: SgNode): string {
  return call.field("function")?.text() ?? "";
}

function isCreateCallOptionObject(objectNode: SgNode, functionName: string): boolean {
  const callInfo = argumentCallForObject(objectNode);
  return (
    callInfo?.index === 0 &&
    callInfo.call.field("function")?.kind() === "identifier" &&
    calleeText(callInfo.call) === functionName
  );
}

function isExecutorOperationObject(objectNode: SgNode): boolean {
  const operationPair = objectNode.parent();
  if (operationPair?.kind() !== "pair" || keyText(operationPair.field("key")) !== "operation") {
    return false;
  }
  const configObject = operationPair.parent();
  return (
    configObject?.kind() === "object" && isCreateCallOptionObject(configObject, "createExecutor")
  );
}

function isSupportedInvokerOptionObject(objectNode: SgNode): boolean {
  return (
    isCreateCallOptionObject(objectNode, "createResolver") ||
    isCreateCallOptionObject(objectNode, "startWorkflow") ||
    isExecutorOperationObject(objectNode)
  );
}

function optionObjectForPairKey(node: SgNode): SgNode | null {
  const parent = node.parent();
  if (!parent || parent.kind() !== "pair") return null;
  const key = parent.field("key");
  if (!key || !sameRange(key, node)) return null;
  const objectNode = parent.parent();
  return objectNode?.kind() === "object" ? objectNode : null;
}

function isSupportedInvokerOptionKey(node: SgNode): boolean {
  const objectNode = optionObjectForPairKey(node) ?? node.parent();
  return objectNode?.kind() === "object" && isSupportedInvokerOptionObject(objectNode);
}

function isSupportedInvokerValueCall(node: SgNode): boolean {
  const pair = node.parent();
  if (pair?.kind() !== "pair") return false;
  const value = pair.field("value");
  if (!value || !sameRange(value, node)) return false;
  const key = keyText(pair.field("key"));
  if (key !== "authInvoker" && key !== "invoker") return false;
  const objectNode = pair.parent();
  return objectNode?.kind() === "object" && isSupportedInvokerOptionObject(objectNode);
}

function findAuthInvokerShorthands(root: SgNode): SgNode[] {
  return root
    .findAll({
      rule: {
        kind: "shorthand_property_identifier",
        regex: "^authInvoker$",
      },
    })
    .filter(isSupportedInvokerOptionKey);
}

function findAuthInvokerPropertyKeys(root: SgNode): SgNode[] {
  return root
    .findAll({
      rule: {
        kind: "property_identifier",
        regex: "^authInvoker$",
      },
    })
    .filter(isSupportedInvokerOptionKey);
}

function findQuotedAuthInvokerPropertyKeys(root: SgNode): SgNode[] {
  return root
    .findAll({
      rule: {
        kind: "string",
        regex: "^['\"]authInvoker['\"]$",
      },
    })
    .filter(isSupportedInvokerOptionKey);
}

function renameQuotedKey(node: SgNode): string {
  const quote = node.text().startsWith("'") ? "'" : '"';
  return `${quote}invoker${quote}`;
}

export interface AuthInvokerTransformOptions {
  renameOptionKeys?: boolean;
}

/**
 * Replace `auth.invoker("name")` calls with the bare `"name"` string literal
 * and optionally rename `authInvoker:` option keys to `invoker:`.
 * If no other `auth` references remain after the rewrite, drop the `auth`
 * specifier (or the entire import line when `auth` was its sole specifier).
 *
 * `auth.invoker()` was removed in favor of passing the machine user name
 * directly to `invoker`; carrying the `auth` import only for `.invoker()`
 * would otherwise pull config-layer modules into runtime bundles.
 * @param source - File contents
 * @param filePath - Absolute path to the file (kept for the runner signature)
 * @param options - Transform behavior flags
 * @returns Transformed source or null when nothing matched.
 */
export function transformAuthInvoker(
  source: string,
  _filePath: string,
  options: AuthInvokerTransformOptions = {},
): string | null {
  if (!quickFilter(source)) return null;

  const renameOptionKeys = options.renameOptionKeys ?? true;
  const lang = source.includes("</") || source.includes("/>") ? Lang.Tsx : Lang.TypeScript;
  const root = parse(lang, source).root();

  const calls = findInvokerCalls(root).filter((c) => isSupportedInvokerValueCall(c.callNode));
  const edits: Edit[] = calls.map((c) => c.callNode.replace(c.argText));
  if (renameOptionKeys) {
    edits.push(...findAuthInvokerPropertyKeys(root).map((node) => node.replace("invoker")));
    edits.push(
      ...findQuotedAuthInvokerPropertyKeys(root).map((node) => node.replace(renameQuotedKey(node))),
    );
    edits.push(
      ...findAuthInvokerShorthands(root).map((node) => node.replace("invoker: authInvoker")),
    );
  }

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

  // Normalize: drop the leading blank line that an import removal at the top
  // of the file leaves behind, and collapse runs of 3+ newlines.
  result = result.replace(/^[\t ]*\n+/, "").replace(/\n{3,}/g, "\n\n");

  return result === source ? null : result;
}

export default function transform(source: string, filePath: string): string | null {
  return transformAuthInvoker(source, filePath);
}
