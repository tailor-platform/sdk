import { parse, Lang } from "@ast-grep/napi";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const RUNTIME_MODULE = "@tailor-platform/sdk/runtime";
const AUTHCONNECTION = "authconnection";
const GET_CONNECTION_TOKEN = "getConnectionToken";
const SOURCE_FILE_EXTENSIONS = new Set([".tsx", ".jsx"]);
const REFERENCE_KINDS = new Set([
  "identifier",
  "shorthand_property_identifier",
  "shorthand_property_identifier_pattern",
]);

interface ImportBinding {
  importStmt: SgNode;
  localName: string;
  importedName?: string;
  source: string;
  spec?: SgNode;
  namespace: boolean;
  typeOnly: boolean;
}

interface AuthBinding {
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
  return source.includes(GET_CONNECTION_TOKEN) && source.includes("tailor.config");
}

function sourceLang(filePath: string, source: string): Lang {
  const lower = filePath.toLowerCase();
  return SOURCE_FILE_EXTENSIONS.has(lower.slice(lower.lastIndexOf("."))) || source.includes("</")
    ? Lang.Tsx
    : Lang.TypeScript;
}

function stringValue(node: SgNode | null): string | null {
  return node?.text().replace(/^['"]|['"]$/g, "") ?? null;
}

function isTypeOnlyImport(stmt: SgNode): boolean {
  return stmt.children().some((child) => child.kind() === "type");
}

function importSource(stmt: SgNode): string | null {
  return stringValue(stmt.find({ rule: { kind: "string" } }) ?? null);
}

function namedImportsNode(importStmt: SgNode): SgNode | null {
  return importStmt.find({ rule: { kind: "named_imports" } }) ?? null;
}

function isTailorConfigSource(source: string): boolean {
  return /(^|\/)tailor\.config(?:\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs))?$/.test(source);
}

function importSpecNames(
  spec: SgNode,
): { importedName: string; localName: string; typeOnly: boolean } | null {
  const ids = spec.children().filter((child) => child.kind() === "identifier");
  if (ids.length === 0) return null;
  return {
    importedName: ids[0]!.text(),
    localName: ids[1]?.text() ?? ids[0]!.text(),
    typeOnly: spec.children().some((child) => child.kind() === "type"),
  };
}

function importBindings(importStmt: SgNode): ImportBinding[] {
  const source = importSource(importStmt);
  if (!source) return [];

  const stmtTypeOnly = isTypeOnlyImport(importStmt);
  const clause = importStmt.children().find((child) => child.kind() === "import_clause");
  if (!clause) return [];

  const bindings: ImportBinding[] = [];
  for (const child of clause.children()) {
    if (child.kind() === "identifier") {
      bindings.push({
        importStmt,
        localName: child.text(),
        source,
        namespace: false,
        typeOnly: stmtTypeOnly,
      });
      continue;
    }

    if (child.kind() === "namespace_import") {
      const local = child.children().find((c) => c.kind() === "identifier");
      if (local) {
        bindings.push({
          importStmt,
          localName: local.text(),
          source,
          namespace: true,
          typeOnly: stmtTypeOnly,
        });
      }
      continue;
    }

    if (child.kind() !== "named_imports") continue;
    for (const spec of child.findAll({ rule: { kind: "import_specifier" } })) {
      const names = importSpecNames(spec);
      if (!names) continue;
      bindings.push({
        importStmt,
        spec,
        source,
        importedName: names.importedName,
        localName: names.localName,
        namespace: false,
        typeOnly: stmtTypeOnly || names.typeOnly,
      });
    }
  }

  return bindings;
}

function findImportStatements(root: SgNode): SgNode[] {
  return root
    .findAll({ rule: { kind: "import_statement" } })
    .filter((stmt) => stmt.parent()?.kind() === "program")
    .toSorted((a, b) => a.range().start.index - b.range().start.index);
}

function findTailorConfigAuthBindings(imports: SgNode[]): AuthBinding[] {
  return imports.flatMap((importStmt) =>
    importBindings(importStmt)
      .filter(
        (binding): binding is ImportBinding & { spec: SgNode; importedName: string } =>
          binding.spec != null &&
          binding.importedName === "auth" &&
          !binding.typeOnly &&
          isTailorConfigSource(binding.source),
      )
      .map((binding) => ({
        importStmt: binding.importStmt,
        localName: binding.localName,
        spec: binding.spec,
      })),
  );
}

function runtimeAuthconnectionReference(imports: SgNode[]): string | null {
  for (const importStmt of imports) {
    for (const binding of importBindings(importStmt)) {
      if (binding.source !== RUNTIME_MODULE || binding.typeOnly) continue;
      if (binding.importedName === AUTHCONNECTION) return binding.localName;
      if (binding.namespace) return `${binding.localName}.${AUTHCONNECTION}`;
    }
  }
  return null;
}

function runtimeNamedValueImport(imports: SgNode[]): SgNode | null {
  return (
    imports.find(
      (stmt) =>
        importSource(stmt) === RUNTIME_MODULE && !isTypeOnlyImport(stmt) && namedImportsNode(stmt),
    ) ?? null
  );
}

function collectBindingNames(node: SgNode, out: Set<string>): void {
  const kind = node.kind();
  if (
    kind === "identifier" ||
    kind === "type_identifier" ||
    kind === "shorthand_property_identifier_pattern"
  ) {
    out.add(node.text());
    return;
  }

  for (const child of node.children()) {
    if (child.kind() === "property_identifier") continue;
    collectBindingNames(child, out);
  }
}

function firstDeclaratorChild(node: SgNode): SgNode | null {
  return node.children().find((child) => child.kind() !== "=") ?? null;
}

function localDeclarationNames(root: SgNode): Set<string> {
  const names = new Set<string>();

  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const binding = firstDeclaratorChild(decl);
    if (binding) collectBindingNames(binding, names);
  }

  for (const param of root.findAll({
    rule: { any: [{ kind: "required_parameter" }, { kind: "optional_parameter" }] },
  })) {
    const binding = param
      .children()
      .find((child) =>
        ["identifier", "object_pattern", "array_pattern", "rest_pattern"].includes(child.kind()),
      );
    if (binding) collectBindingNames(binding, names);
  }

  for (const decl of root.findAll({
    rule: {
      any: [
        { kind: "function_declaration" },
        { kind: "function_expression" },
        { kind: "class_declaration" },
        { kind: "class" },
        { kind: "enum_declaration" },
        { kind: "internal_module" },
        { kind: "import_alias" },
      ],
    },
  })) {
    const name = decl.children().find((child) => child.kind() === "identifier");
    if (name) names.add(name.text());
  }

  for (const catchClause of root.findAll({ rule: { kind: "catch_clause" } })) {
    for (const child of catchClause.children()) {
      if (["identifier", "object_pattern", "array_pattern"].includes(child.kind())) {
        collectBindingNames(child, names);
      }
    }
  }

  for (const arrow of root.findAll({ rule: { kind: "arrow_function" } })) {
    const children = arrow.children();
    const arrowIndex = children.findIndex((child) => child.kind() === "=>");
    if (arrowIndex === -1) continue;
    for (const child of children.slice(0, arrowIndex)) {
      collectBindingNames(child, names);
    }
  }

  for (const loop of root.findAll({ rule: { kind: "for_in_statement" } })) {
    const children = loop.children();
    const keywordIndex = children.findIndex(
      (child) => child.kind() === "in" || child.kind() === "of",
    );
    if (keywordIndex === -1) continue;
    for (const child of children.slice(0, keywordIndex)) {
      collectBindingNames(child, names);
    }
  }

  return names;
}

function hasRuntimeImportCollision(root: SgNode, imports: SgNode[]): boolean {
  const localNames = localDeclarationNames(root);
  if (localNames.has(AUTHCONNECTION)) return true;

  return imports.some((importStmt) =>
    importBindings(importStmt).some(
      (binding) =>
        !binding.typeOnly &&
        binding.localName === AUTHCONNECTION &&
        !(
          binding.source === RUNTIME_MODULE &&
          binding.importedName === AUTHCONNECTION &&
          !binding.namespace
        ),
    ),
  );
}

function hasRuntimeReferenceShadow(root: SgNode, runtimeRef: string): boolean {
  return localDeclarationNames(root).has(runtimeRef.split(".")[0]!);
}

function findAuthConnectionTokenCalls(root: SgNode, authLocalNames: Set<string>): TokenCall[] {
  const calls: TokenCall[] = [];
  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    const callee = call.field("function");
    if (callee?.kind() !== "member_expression") continue;

    const property = callee.field("property");
    const object = callee.field("object");
    if (
      property?.text() !== GET_CONNECTION_TOKEN ||
      object?.kind() !== "identifier" ||
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
  let current: SgNode | null = node.parent();
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
    .findAll({ rule: { any: [...REFERENCE_KINDS].map((kind) => ({ kind })) } })
    .filter((node) => node.text() === localName)
    .filter(
      (node) => !isInsideImportStatement(node) && !isInsideScheduledRange(node, scheduledRanges),
    ).length;
}

function importClause(importStmt: SgNode): SgNode | null {
  return importStmt.children().find((child) => child.kind() === "import_clause") ?? null;
}

function hasDefaultOrNamespaceImport(importStmt: SgNode): boolean {
  return (
    importClause(importStmt)
      ?.children()
      .some((child) => child.kind() === "identifier" || child.kind() === "namespace_import") ??
    false
  );
}

function buildOnlyNamedImportRemovalEdit(source: string, importStmt: SgNode): Edit | null {
  const named = namedImportsNode(importStmt);
  if (!named) return null;

  let start = named.range().start.index;
  const end = named.range().end.index;
  while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
  if (source[start - 1] === ",") {
    start--;
    while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
  }
  return { startPos: start, endPos: end, insertedText: "" };
}

function buildImportSpecRemovalEdit(source: string, binding: AuthBinding): Edit | null {
  const allSpecs = binding.importStmt.findAll({ rule: { kind: "import_specifier" } });
  if (allSpecs.length === 1) {
    if (hasDefaultOrNamespaceImport(binding.importStmt)) {
      return buildOnlyNamedImportRemovalEdit(source, binding.importStmt);
    }

    const r = binding.importStmt.range();
    return { startPos: r.start.index, endPos: r.end.index, insertedText: "" };
  }

  const r = binding.spec.range();
  let start = r.start.index;
  let end = r.end.index;
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

function isDirectiveStatement(node: SgNode): boolean {
  return node.kind() === "expression_statement" && node.children()[0]?.kind() === "string";
}

function importInsertionIndex(root: SgNode, imports: SgNode[], source: string): number {
  const lastImport = imports.at(-1);
  if (lastImport) return lastImport.range().end.index;

  let pos = 0;
  if (source.startsWith("#!")) {
    const newlineIndex = source.indexOf("\n");
    pos = newlineIndex === -1 ? source.length : newlineIndex + 1;
  }

  for (const child of root.children()) {
    if (child.range().start.index < pos) continue;
    if (child.kind() === "comment") {
      pos = child.range().end.index;
      continue;
    }
    if (!isDirectiveStatement(child)) break;
    pos = child.range().end.index;
  }

  return pos;
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

function applyEdits(source: string, edits: Edit[]): string {
  return edits
    .toSorted((a, b) => b.startPos - a.startPos || b.endPos - a.endPos)
    .reduce(
      (current, edit) =>
        `${current.slice(0, edit.startPos)}${edit.insertedText}${current.slice(edit.endPos)}`,
      source,
    );
}

function normalizeSource(source: string): string {
  return source.replace(/^[\t ]*\n+/, "").replace(/\n{3,}/g, "\n\n");
}

function transformParsed(source: string, root: SgNode): string | null {
  const imports = findImportStatements(root);
  const authBindings = findTailorConfigAuthBindings(imports);
  if (authBindings.length === 0) return null;

  const authLocalNames = new Set(authBindings.map((binding) => binding.localName));
  const calls = findAuthConnectionTokenCalls(root, authLocalNames);
  if (calls.length === 0) return null;

  const existingRuntimeRef = runtimeAuthconnectionReference(imports);
  if (!existingRuntimeRef && hasRuntimeImportCollision(root, imports)) return null;
  if (existingRuntimeRef && hasRuntimeReferenceShadow(root, existingRuntimeRef)) return null;

  const runtimeRef = existingRuntimeRef ?? AUTHCONNECTION;
  const edits: Edit[] = calls.map((call) => call.objectNode.replace(runtimeRef));

  if (!existingRuntimeRef) {
    edits.push(buildAddRuntimeImportEdit(root, source, imports));
  }

  const scheduledRangesByLocalName = new Map<string, Array<[number, number]>>();
  for (const call of calls) {
    const ranges = scheduledRangesByLocalName.get(call.localName) ?? [];
    ranges.push(call.range);
    scheduledRangesByLocalName.set(call.localName, ranges);
  }

  for (const binding of authBindings) {
    if (calls.every((call) => call.localName !== binding.localName)) continue;
    const remainingRefs = countRemainingRefs(
      root,
      binding.localName,
      scheduledRangesByLocalName.get(binding.localName) ?? [],
    );
    if (remainingRefs > 0) continue;
    const edit = buildImportSpecRemovalEdit(source, binding);
    if (edit) edits.push(edit);
  }

  const result = normalizeSource(applyEdits(source, edits));
  return result === source ? null : result;
}

function parseRoot(source: string, filePath: string): SgNode | null {
  if (!quickFilter(source)) return null;
  try {
    return parse(sourceLang(filePath, source), source).root();
  } catch {
    return null;
  }
}

export default function transform(source: string, filePath: string): string | null {
  const root = parseRoot(source, filePath);
  return root ? transformParsed(source, root) : null;
}

function lineForIndex(source: string, index: number): number {
  return source.slice(0, index).split(/\r\n|\r|\n/).length;
}

function excerptForIndex(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  const lineEnd = source.indexOf("\n", index);
  return source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim();
}

export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  const root = parseRoot(source, filePath);
  if (!root) return [];

  const imports = findImportStatements(root);
  const authBindings = findTailorConfigAuthBindings(imports);
  const calls = findAuthConnectionTokenCalls(
    root,
    new Set(authBindings.map((binding) => binding.localName)),
  );

  return calls.map((call) => ({
    file: relativePath,
    line: lineForIndex(source, call.range[0]),
    message: "Replace defineAuth auth.getConnectionToken() with runtime authconnection.",
    excerpt: excerptForIndex(source, call.range[0]),
  }));
}
