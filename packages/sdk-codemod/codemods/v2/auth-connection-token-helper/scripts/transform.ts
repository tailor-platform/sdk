import { parse, Lang } from "@ast-grep/napi";
import {
  findImportStatements,
  importSource,
  importSpecNames,
  isTypeOnlyImport,
  localDeclarationNames,
  namedImportsNode,
} from "../../../../src/ast-grep-helpers";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const RUNTIME_MODULE = "@tailor-platform/sdk/runtime";
const AUTHCONNECTION = "authconnection";
const GET_CONNECTION_TOKEN = "getConnectionToken";
const JSX_FILE_EXTENSIONS = new Set([".tsx", ".jsx"]);
const JS_FILE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

interface AuthImport {
  importStmt: SgNode;
  localName: string;
  spec: SgNode;
}

interface TokenCall {
  objectNode: SgNode;
  localName: string;
  range: [number, number];
}

function quickFilter(source: string): boolean {
  return source.includes(GET_CONNECTION_TOKEN);
}

function sourceLang(filePath: string, source: string): Lang {
  const lower = filePath.toLowerCase();
  const extension = lower.slice(lower.lastIndexOf("."));
  if (JSX_FILE_EXTENSIONS.has(extension)) return Lang.Tsx;
  if (JS_FILE_EXTENSIONS.has(extension) && /<>|<\/>|<[A-Za-z][\w.$:-]/.test(source)) {
    return Lang.Tsx;
  }
  return Lang.TypeScript;
}

function parseRoot(source: string, filePath: string): SgNode | null {
  if (!quickFilter(source)) return null;
  try {
    return parse(sourceLang(filePath, source), source).root();
  } catch {
    return null;
  }
}

function isTailorConfigSource(source: string): boolean {
  return /(^|\/)tailor\.config(?:\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs))?$/.test(source);
}

function findAuthImports(imports: SgNode[]): AuthImport[] {
  const authImports: AuthImport[] = [];
  for (const importStmt of imports) {
    const source = importSource(importStmt);
    if (!source || !isTailorConfigSource(source) || isTypeOnlyImport(importStmt)) continue;

    for (const spec of importStmt.findAll({ rule: { kind: "import_specifier" } })) {
      const names = importSpecNames(spec);
      if (names?.importedName !== "auth" || names.typeOnly) continue;
      authImports.push({ importStmt, localName: names.localName, spec });
    }
  }
  return authImports;
}

function importLocalNames(importStmt: SgNode): Set<string> {
  const names = new Set<string>();
  const clause = importStmt.children().find((child) => child.kind() === "import_clause");
  if (!clause) return names;

  for (const child of clause.children()) {
    if (child.kind() === "identifier") {
      names.add(child.text());
      continue;
    }
    if (child.kind() === "namespace_import") {
      const local = child.children().find((grandchild) => grandchild.kind() === "identifier");
      if (local) names.add(local.text());
      continue;
    }
    if (child.kind() !== "named_imports") continue;
    for (const spec of child.findAll({ rule: { kind: "import_specifier" } })) {
      const specNames = importSpecNames(spec);
      if (specNames && !specNames.typeOnly) names.add(specNames.localName);
    }
  }
  return names;
}

function runtimeAuthconnectionReference(imports: SgNode[]): string | null {
  for (const importStmt of imports) {
    if (importSource(importStmt) !== RUNTIME_MODULE || isTypeOnlyImport(importStmt)) continue;
    for (const spec of importStmt.findAll({ rule: { kind: "import_specifier" } })) {
      const names = importSpecNames(spec);
      if (names?.importedName === AUTHCONNECTION) return names.localName;
    }

    const clause = importStmt.children().find((child) => child.kind() === "import_clause");
    const namespace = clause?.children().find((child) => child.kind() === "namespace_import");
    const local = namespace?.children().find((child) => child.kind() === "identifier");
    if (local) return `${local.text()}.${AUTHCONNECTION}`;
  }
  return null;
}

function runtimeNamedValueImport(imports: SgNode[]): SgNode | null {
  return (
    imports.find(
      (importStmt) =>
        importSource(importStmt) === RUNTIME_MODULE &&
        !isTypeOnlyImport(importStmt) &&
        namedImportsNode(importStmt),
    ) ?? null
  );
}

function hasRuntimeImportCollision(root: SgNode, imports: SgNode[]): boolean {
  if (localDeclarationNames(root).has(AUTHCONNECTION)) return true;
  return imports.some(
    (importStmt) =>
      importLocalNames(importStmt).has(AUTHCONNECTION) &&
      importSource(importStmt) !== RUNTIME_MODULE,
  );
}

function hasAuthLocalCollision(root: SgNode, authLocalNames: Set<string>): boolean {
  const localNames = localDeclarationNames(root);
  return Array.from(authLocalNames).some((name) => localNames.has(name));
}

function findDirectAuthCalls(root: SgNode, authLocalNames: Set<string>): TokenCall[] {
  const calls: TokenCall[] = [];
  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    const callee = call.field("function");
    if (callee?.kind() !== "member_expression") continue;

    const object = callee.field("object");
    const property = callee.field("property");
    if (
      object?.kind() !== "identifier" ||
      property?.text() !== GET_CONNECTION_TOKEN ||
      !authLocalNames.has(object.text())
    ) {
      continue;
    }

    const range = object.range();
    calls.push({
      objectNode: object,
      localName: object.text(),
      range: [range.start.index, range.end.index],
    });
  }
  return calls;
}

function isInsideImportStatement(node: SgNode): boolean {
  let current = node.parent();
  while (current) {
    if (current.kind() === "import_statement") return true;
    current = current.parent();
  }
  return false;
}

function isInsideScheduledRange(node: SgNode, ranges: Array<[number, number]>): boolean {
  const start = node.range().start.index;
  return ranges.some(([rangeStart, rangeEnd]) => start >= rangeStart && start < rangeEnd);
}

function countRemainingRefs(
  root: SgNode,
  localName: string,
  scheduledRanges: Array<[number, number]>,
): number {
  return root
    .findAll({ rule: { any: [{ kind: "identifier" }, { kind: "shorthand_property_identifier" }] } })
    .filter((node) => node.text() === localName)
    .filter(
      (node) => !isInsideImportStatement(node) && !isInsideScheduledRange(node, scheduledRanges),
    ).length;
}

function importInsertionIndex(root: SgNode, imports: SgNode[], source: string): number {
  const lastImport = imports.at(-1);
  if (lastImport) return lastImport.range().end.index;

  if (source.startsWith("#!")) {
    const newlineIndex = source.indexOf("\n");
    return newlineIndex === -1 ? source.length : newlineIndex + 1;
  }
  return (
    root
      .children()
      .find((child) => child.kind() !== "comment")
      ?.range().start.index ?? 0
  );
}

function buildAddRuntimeImportEdit(root: SgNode, source: string, imports: SgNode[]): Edit {
  const existingRuntimeImport = runtimeNamedValueImport(imports);
  const namedImports = existingRuntimeImport ? namedImportsNode(existingRuntimeImport) : null;
  if (namedImports) {
    const specTexts = namedImports
      .findAll({ rule: { kind: "import_specifier" } })
      .map((spec) => spec.text());
    return namedImports.replace(`{ ${[...specTexts, AUTHCONNECTION].join(", ")} }`);
  }

  const pos = importInsertionIndex(root, imports, source);
  const insertedText =
    pos === 0 || source[pos - 1] === "\n"
      ? `import { ${AUTHCONNECTION} } from "${RUNTIME_MODULE}";\n\n`
      : `\nimport { ${AUTHCONNECTION} } from "${RUNTIME_MODULE}";`;
  return { startPos: pos, endPos: pos, insertedText };
}

function lineStartIndex(source: string, index: number): number {
  let pos = index;
  while (pos > 0 && source[pos - 1] !== "\n" && source[pos - 1] !== "\r") pos--;
  return pos;
}

function consumeLineBreak(source: string, index: number): number {
  if (source[index] === "\r") return source[index + 1] === "\n" ? index + 2 : index + 1;
  if (source[index] === "\n") return index + 1;
  return index;
}

function isHorizontalWhitespace(source: string, start: number, end: number): boolean {
  for (let index = start; index < end; index++) {
    if (source[index] !== " " && source[index] !== "\t") return false;
  }
  return true;
}

function buildImportRemovalEdit(source: string, binding: AuthImport): Edit | null {
  const allSpecs = binding.importStmt.findAll({ rule: { kind: "import_specifier" } });
  if (allSpecs.length === 1) {
    const range = binding.importStmt.range();
    let end = range.end.index;
    if (source[end] === "\n") end++;
    return { startPos: range.start.index, endPos: end, insertedText: "" };
  }

  const range = binding.spec.range();
  let start = range.start.index;
  let end = range.end.index;
  const specEnd = end;
  while (end < source.length && /[ \t]/.test(source[end]!)) end++;
  if (source[end] === ",") {
    end++;
    while (end < source.length && /[ \t]/.test(source[end]!)) end++;
    const nextLine = consumeLineBreak(source, end);
    const lineStart = lineStartIndex(source, start);
    if (nextLine !== end && isHorizontalWhitespace(source, lineStart, start)) {
      return { startPos: lineStart, endPos: nextLine, insertedText: "" };
    }
    return { startPos: start, endPos: end, insertedText: "" };
  }

  const nextLine = consumeLineBreak(source, end);
  const lineStart = lineStartIndex(source, start);
  if (nextLine !== end && isHorizontalWhitespace(source, lineStart, start)) {
    return { startPos: lineStart, endPos: nextLine, insertedText: "" };
  }

  while (start > 0 && /[ \t]/.test(source[start - 1]!)) start--;
  if (source[start - 1] === ",") start--;
  return { startPos: start, endPos: specEnd, insertedText: "" };
}

function applyEdits(source: string, edits: Edit[]): string {
  return edits
    .toSorted((a, b) => b.startPos - a.startPos || b.endPos - a.endPos)
    .reduce(
      (current, edit) =>
        `${current.slice(0, edit.startPos)}${edit.insertedText}${current.slice(edit.endPos)}`,
      source,
    )
    .replace(/^\n+/, "");
}

function transformParsed(source: string, root: SgNode): string | null {
  const imports = findImportStatements(root);
  const authImports = findAuthImports(imports);
  if (authImports.length === 0) return null;

  const authLocalNames = new Set(authImports.map((binding) => binding.localName));
  if (hasAuthLocalCollision(root, authLocalNames)) return null;

  const calls = findDirectAuthCalls(root, authLocalNames);
  if (calls.length === 0) return null;

  const existingRuntimeRef = runtimeAuthconnectionReference(imports);
  if (!existingRuntimeRef && hasRuntimeImportCollision(root, imports)) return null;

  const runtimeRef = existingRuntimeRef ?? AUTHCONNECTION;
  const edits: Edit[] = calls.map((call) => call.objectNode.replace(runtimeRef));
  if (!existingRuntimeRef) edits.push(buildAddRuntimeImportEdit(root, source, imports));

  const scheduledRangesByLocalName = new Map<string, Array<[number, number]>>();
  for (const call of calls) {
    const ranges = scheduledRangesByLocalName.get(call.localName) ?? [];
    ranges.push(call.range);
    scheduledRangesByLocalName.set(call.localName, ranges);
  }

  for (const binding of authImports) {
    if (!scheduledRangesByLocalName.has(binding.localName)) continue;
    const remainingRefs = countRemainingRefs(
      root,
      binding.localName,
      scheduledRangesByLocalName.get(binding.localName) ?? [],
    );
    if (remainingRefs > 0) continue;
    const edit = buildImportRemovalEdit(source, binding);
    if (edit) edits.push(edit);
  }

  const result = applyEdits(source, edits);
  return result === source ? null : result;
}

export default function transform(source: string, filePath: string): string | null {
  const root = parseRoot(source, filePath);
  return root ? transformParsed(source, root) : null;
}

function lineForIndex(source: string, index: number): number {
  return source.slice(0, index).split(/\r\n|\r|\n/).length;
}

function excerptForLine(line: string): string {
  return line.trim();
}

function isReviewLine(excerpt: string): boolean {
  if (!excerpt.includes(GET_CONNECTION_TOKEN)) return false;
  if (
    excerpt.includes(`${AUTHCONNECTION}.${GET_CONNECTION_TOKEN}`) ||
    excerpt.includes(`tailor.${AUTHCONNECTION}.${GET_CONNECTION_TOKEN}`)
  ) {
    return false;
  }
  return (
    excerpt.includes(`.${GET_CONNECTION_TOKEN}`) ||
    excerpt.includes(`["${GET_CONNECTION_TOKEN}"]`) ||
    excerpt.includes(`['${GET_CONNECTION_TOKEN}']`) ||
    new RegExp(`[,{]\\s*${GET_CONNECTION_TOKEN}\\s*[:}=,]`).test(excerpt)
  );
}

export function reviewFindings(
  source: string,
  _filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  if (!quickFilter(source)) return [];

  const findings: LlmReviewFinding[] = [];
  let offset = 0;
  for (const line of source.split(/\n/)) {
    const excerpt = excerptForLine(line);
    if (isReviewLine(excerpt)) {
      findings.push({
        file: relativePath,
        line: lineForIndex(source, offset),
        message: "Replace defineAuth auth.getConnectionToken() with runtime authconnection.",
        excerpt,
      });
    }
    offset += line.length + 1;
  }
  return findings;
}
