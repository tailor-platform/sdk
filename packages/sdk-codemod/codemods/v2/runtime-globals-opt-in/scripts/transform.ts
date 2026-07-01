import { parse, Lang } from "@ast-grep/napi";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const RUNTIME_MODULE = "@tailor-platform/sdk/runtime";
const TAILOR_IDP_CLIENT = "tailor.idp.Client";
const RUNTIME_ROOT_NAME_PATTERN = String.raw`(tailor|tailordb|Tailor(?:DBFileError|Errors|ErrorMessage|ErrorItem))`;
const TAILOR_RUNTIME_MEMBER_PATTERN = String.raw`(?:authconnection|context|iconv|idp|secretmanager|workflow)`;
const TAILORDB_RUNTIME_MEMBER_PATTERN = String.raw`(?:Client|CommandType|QueryResult|file)`;
const RUNTIME_ERROR_GLOBAL_PATTERN = String.raw`Tailor(?:DBFileError|Errors|ErrorMessage|ErrorItem)`;
const DIRECT_RUNTIME_GLOBAL_PATTERN = new RegExp(
  String.raw`^\s*(?:tailor\s*(?:\.|\?\.|!\s*\.)\s*${TAILOR_RUNTIME_MEMBER_PATTERN}\b|tailor\s*(?:\?\.|!\s*)?\[|tailordb\s*(?:\.|\?\.|!\s*\.)\s*${TAILORDB_RUNTIME_MEMBER_PATTERN}\b|tailordb\s*(?:\?\.|!\s*)?\[|${RUNTIME_ERROR_GLOBAL_PATTERN}\b)`,
);
const GLOBAL_OBJECT_RUNTIME_ROOT_PATTERN = new RegExp(
  String.raw`^\s*(globalThis|global)\s*(?:(?:\.|\?\.|!\s*\.)\s*${RUNTIME_ROOT_NAME_PATTERN}\b|(?:\?\.|!\s*)?\[\s*["']${RUNTIME_ROOT_NAME_PATTERN}["']\s*\])`,
);
const SOURCE_STRING_RUNTIME_GLOBAL_PATTERN = new RegExp(
  String.raw`(?:^|[\r\n]\s*|(?:=>|[=(:,<{\[])\s*|\b(?:return|await|typeof|new)\s+)(?:new\s+)?(?:tailor\s*(?:\.|\?\.|!\s*\.)\s*${TAILOR_RUNTIME_MEMBER_PATTERN}\b|tailordb\s*(?:\.|\?\.|!\s*\.)\s*${TAILORDB_RUNTIME_MEMBER_PATTERN}\b|(?:globalThis|global)\s*(?:\.|\?\.|!\s*\.)\s*${RUNTIME_ROOT_NAME_PATTERN}\b|${RUNTIME_ERROR_GLOBAL_PATTERN}\.[A-Za-z_$][\w$]*)`,
);
const REVIEW_TEXT_FILTER_PATTERN =
  /\b(?:tailor|tailordb|Tailor(?:DBFileError|Errors|ErrorMessage|ErrorItem)|globalThis|global)\b/;
const REVIEW_NODE_KINDS = new Set([
  "identifier",
  "member_expression",
  "nested_identifier",
  "nested_type_identifier",
  "subscript_expression",
  "type_identifier",
]);
const NON_ARGUMENT_KINDS = new Set(["(", ")", ",", "comment"]);

interface ImportBinding {
  localName: string;
  importedName?: string;
  source: string;
  typeOnly: boolean;
}

function quickFilter(source: string): boolean {
  return source.includes(TAILOR_IDP_CLIENT);
}

function sourceLang(filePath: string, source: string): Lang {
  return filePath.endsWith(".tsx") || filePath.endsWith(".jsx") || source.includes("</")
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
  const source = stmt.find({ rule: { kind: "string" } });
  return stringValue(source ?? null);
}

function namedImportsNode(importStmt: SgNode): SgNode | null {
  return importStmt.find({ rule: { kind: "named_imports" } }) ?? null;
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

  const requireClause = importStmt
    .children()
    .find((child) => child.kind() === "import_require_clause");
  if (requireClause) {
    const local = requireClause.children().find((child) => child.kind() === "identifier");
    return local ? [{ localName: local.text(), source, typeOnly: false }] : [];
  }

  const typeOnly = isTypeOnlyImport(importStmt);
  const clause = importStmt.children().find((child) => child.kind() === "import_clause");
  if (!clause) return [];

  const bindings: ImportBinding[] = [];
  for (const child of clause.children()) {
    if (child.kind() === "identifier") {
      bindings.push({ localName: child.text(), source, typeOnly });
      continue;
    }

    if (child.kind() === "namespace_import") {
      const local = child.children().find((c) => c.kind() === "identifier");
      if (local) bindings.push({ localName: local.text(), source, typeOnly });
      continue;
    }

    if (child.kind() !== "named_imports") continue;
    for (const spec of child.findAll({ rule: { kind: "import_specifier" } })) {
      const names = importSpecNames(spec);
      if (!names) continue;
      bindings.push({ ...names, source, typeOnly: typeOnly || names.typeOnly });
    }
  }

  return bindings;
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
        { kind: "interface_declaration" },
        { kind: "type_alias_declaration" },
        { kind: "enum_declaration" },
        { kind: "internal_module" },
        { kind: "import_alias" },
      ],
    },
  })) {
    const name = decl
      .children()
      .find((child) => child.kind() === "identifier" || child.kind() === "type_identifier");
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

function importedNames(imports: SgNode[]): Set<string> {
  const names = new Set<string>();
  for (const importStmt of imports) {
    for (const binding of importBindings(importStmt)) {
      names.add(binding.localName);
    }
  }
  return names;
}

function findImportStatements(root: SgNode): SgNode[] {
  return root
    .findAll({ rule: { kind: "import_statement" } })
    .filter((stmt) => stmt.parent()?.kind() === "program")
    .toSorted((a, b) => a.range().start.index - b.range().start.index);
}

function runtimeIdpLocalName(imports: SgNode[]): string | null {
  for (const importStmt of imports) {
    for (const binding of importBindings(importStmt)) {
      if (
        binding.source === RUNTIME_MODULE &&
        binding.importedName === "idp" &&
        !binding.typeOnly
      ) {
        return binding.localName;
      }
    }
  }
  return null;
}

function hasCollision(
  imports: SgNode[],
  localNames: Set<string>,
  idpLocal: string,
  injectingNewIdpName: boolean,
): boolean {
  if (
    localNames.has("tailor") ||
    (injectingNewIdpName && localNames.has("idp")) ||
    localNames.has(idpLocal)
  )
    return true;

  for (const importStmt of imports) {
    for (const binding of importBindings(importStmt)) {
      if (binding.localName === "tailor") return true;
      if (
        binding.localName === "idp" &&
        !(binding.source === RUNTIME_MODULE && binding.importedName === "idp" && !binding.typeOnly)
      ) {
        return true;
      }
    }
  }

  return false;
}

function runtimeNamedValueImport(imports: SgNode[]): SgNode | null {
  return (
    imports.find(
      (stmt) =>
        importSource(stmt) === RUNTIME_MODULE && !isTypeOnlyImport(stmt) && namedImportsNode(stmt),
    ) ?? null
  );
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
    return namedImports.replace(`{ ${[...specTexts, "idp"].join(", ")} }`);
  }

  const pos = importInsertionIndex(root, imports, source);
  const insertedText =
    pos === 0 || (pos > 0 && source[pos - 1] === "\n")
      ? `import { idp } from "${RUNTIME_MODULE}";\n\n`
      : `\nimport { idp } from "${RUNTIME_MODULE}";`;
  return { startPos: pos, endPos: pos, insertedText };
}

function argumentExpressions(args: SgNode): SgNode[] {
  return args.children().filter((child) => !NON_ARGUMENT_KINDS.has(child.kind()));
}

function hasConstructorArguments(newExpression: SgNode): boolean {
  const args = newExpression.field("arguments");
  return args ? argumentExpressions(args).length > 0 : false;
}

function findTailorIdpClientConstructors(root: SgNode): SgNode[] {
  return root
    .findAll({ rule: { kind: "new_expression" } })
    .filter(hasConstructorArguments)
    .map((node) => node.field("constructor"))
    .filter((node): node is SgNode => node?.text() === TAILOR_IDP_CLIENT);
}

function excerptForLine(source: string, line: number): string {
  return source.split(/\r?\n/)[line - 1]?.trimEnd() ?? "";
}

function addReviewFinding(
  findings: LlmReviewFinding[],
  seen: Set<string>,
  source: string,
  file: string,
  line: number,
  message: string,
): void {
  const excerpt = excerptForLine(source, line);
  const key = `${file}:${line}:${message}:${excerpt}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ file, line, message, excerpt });
}

function runtimeRootReference(
  source: string,
): { rootName: string; globalObjectName?: string } | null {
  const globalObjectMatch = GLOBAL_OBJECT_RUNTIME_ROOT_PATTERN.exec(source);
  if (globalObjectMatch) {
    return {
      rootName: globalObjectMatch[2] ?? globalObjectMatch[3]!,
      globalObjectName: globalObjectMatch[1]!,
    };
  }

  const directMatch = DIRECT_RUNTIME_GLOBAL_PATTERN.exec(source);
  return directMatch
    ? { rootName: directMatch[1] ?? directMatch[0].trim().split(/\W/, 1)[0]! }
    : null;
}

function hasAncestorKind(node: SgNode, kind: string): boolean {
  let current = node.parent();
  while (current) {
    if (current.kind() === kind) return true;
    current = current.parent();
  }
  return false;
}

function isObjectPairKey(parent: SgNode, stringNode: SgNode): boolean {
  if (parent.kind() !== "pair") return false;
  const children = parent.children();
  const colonIndex = children.findIndex((child) => child.kind() === ":");
  const stringIndex = children.findIndex(
    (child) => child.range().start.index === stringNode.range().start.index,
  );
  return stringIndex !== -1 && colonIndex !== -1 && stringIndex < colonIndex;
}

function isNonCodeStringFragment(fragment: SgNode): boolean {
  const stringNode = fragment.parent();
  if (!stringNode) return false;
  const parent = stringNode.parent();
  if (!parent) return false;
  if (parent.kind() === "subscript_expression") return true;
  if (isObjectPairKey(parent, stringNode)) return true;
  if (hasAncestorKind(stringNode, "import_statement")) return true;
  return hasAncestorKind(stringNode, "export_statement");
}

function collectStringRuntimeGlobalFindings(
  root: SgNode,
  source: string,
  file: string,
  findings: LlmReviewFinding[],
  seen: Set<string>,
): void {
  for (const fragment of root.findAll({ rule: { kind: "string_fragment" } })) {
    if (isNonCodeStringFragment(fragment)) continue;
    const startLine = fragment.range().start.line + 1;
    const lines = fragment.text().split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!SOURCE_STRING_RUNTIME_GLOBAL_PATTERN.test(lines[i]!)) continue;
      addReviewFinding(
        findings,
        seen,
        source,
        file,
        startLine + i,
        "Embedded code string uses Tailor runtime globals and needs manual migration.",
      );
    }
  }
}

function collectDirectRuntimeGlobalFindings(
  root: SgNode,
  source: string,
  file: string,
  findings: LlmReviewFinding[],
  seen: Set<string>,
): void {
  const imports = findImportStatements(root);
  const localNames = localDeclarationNames(root);
  const importNames = importedNames(imports);

  for (const node of root.findAll({
    rule: { any: [...REVIEW_NODE_KINDS].map((kind) => ({ kind })) },
  })) {
    const rootRef = runtimeRootReference(node.text());
    if (!rootRef) continue;
    if (localNames.has(rootRef.rootName) || importNames.has(rootRef.rootName)) continue;
    if (
      rootRef.globalObjectName &&
      (localNames.has(rootRef.globalObjectName) || importNames.has(rootRef.globalObjectName))
    ) {
      continue;
    }
    addReviewFinding(
      findings,
      seen,
      source,
      file,
      node.range().start.line + 1,
      "Tailor runtime global reference remains after automatic migration.",
    );
  }
}

export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  if (!REVIEW_TEXT_FILTER_PATTERN.test(source)) return [];

  let root: SgNode;
  try {
    root = parse(sourceLang(filePath, source), source).root();
  } catch {
    return [];
  }

  const findings: LlmReviewFinding[] = [];
  const seen = new Set<string>();
  collectDirectRuntimeGlobalFindings(root, source, relativePath, findings, seen);
  collectStringRuntimeGlobalFindings(root, source, relativePath, findings, seen);
  return findings;
}

/**
 * Rewrite direct `new tailor.idp.Client(...)` calls to the typed runtime
 * wrapper. Files with local `tailor` or conflicting `idp` bindings are left
 * unchanged for the runtime-globals review prompt.
 * @param source - File contents
 * @param filePath - Absolute path to the file
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!quickFilter(source)) return null;

  const root = parse(sourceLang(filePath, source), source).root();
  const constructors = findTailorIdpClientConstructors(root);
  if (constructors.length === 0) return null;

  const imports = findImportStatements(root);
  const existingIdpLocal = runtimeIdpLocalName(imports);
  const idpLocal = existingIdpLocal ?? "idp";
  if (hasCollision(imports, localDeclarationNames(root), idpLocal, existingIdpLocal === null)) {
    return null;
  }

  const edits: Edit[] = constructors.map((constructor) =>
    constructor.replace(`${idpLocal}.Client`),
  );

  if (!existingIdpLocal) {
    if (filePath.endsWith(".cts")) return null;
    edits.push(buildAddRuntimeImportEdit(root, source, imports));
  }

  const result = root.commitEdits(edits);
  return result === source ? null : result;
}
