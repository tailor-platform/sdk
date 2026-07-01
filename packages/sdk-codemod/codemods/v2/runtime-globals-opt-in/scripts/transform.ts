import { parse, Lang } from "@ast-grep/napi";
import {
  matchesRuntimeGlobalsSourceString,
  runtimeGlobalTextPattern,
} from "../../../../src/runtime-globals-patterns";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const RUNTIME_MODULE = "@tailor-platform/sdk/runtime";
const TAILOR_IDP_CLIENT = "tailor.idp.Client";
const NON_ARGUMENT_KINDS = new Set(["(", ")", ",", "comment"]);
const REVIEW_NODE_KINDS = new Set([
  "member_expression",
  "identifier",
  "nested_type_identifier",
  "shorthand_property_identifier",
  "subscript_expression",
  "type_identifier",
]);
const REVIEW_SCOPE_KINDS = new Set([
  "program",
  "statement_block",
  "function_declaration",
  "function_expression",
  "arrow_function",
  "method_definition",
]);
const REVIEW_VALUE_DECLARATION_KINDS = [
  "function_declaration",
  "class_declaration",
  "enum_declaration",
  "internal_module",
  "import_alias",
];
const REVIEW_TYPE_DECLARATION_KINDS = [
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "internal_module",
  "import_alias",
];
const REVIEW_BINDING_LEFT_SIDE_KINDS = new Set([
  "object_assignment_pattern",
  "optional_parameter",
  "required_parameter",
  "variable_declarator",
]);
const REVIEW_DECLARATION_REFERENCE_ANCESTOR_KINDS = new Set([
  "export_clause",
  "export_specifier",
  "import_statement",
]);
const REVIEW_FOR_BINDING_DECLARATION_KINDS = new Set([
  "lexical_declaration",
  "variable_declaration",
]);
const REVIEW_FOR_KINDS = new Set(["for_statement", "for_in_statement"]);

type BindingNamespace = "type" | "value";

interface RuntimeBindingNames {
  type: Set<string>;
  value: Set<string>;
}

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

  const children = node.children();
  const equalsIndex = REVIEW_BINDING_LEFT_SIDE_KINDS.has(kind)
    ? children.findIndex((child) => child.kind() === "=")
    : -1;
  const bindingChildren = equalsIndex === -1 ? children : children.slice(0, equalsIndex);

  for (const child of bindingChildren) {
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
  const excerpt = (source.split(/\r?\n/)[line - 1] ?? "").trim();
  return excerpt.length > 160 ? `${excerpt.slice(0, 157)}...` : excerpt;
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

function runtimeRootName(source: string): string | null {
  return (
    /^\s*(tailor|tailordb|Tailor(?:DBFileError|Errors|ErrorMessage|ErrorItem))\b/.exec(
      source,
    )?.[1] ?? null
  );
}

function importedRuntimeNames(imports: SgNode[]): RuntimeBindingNames {
  const names: RuntimeBindingNames = { type: new Set<string>(), value: new Set<string>() };
  for (const importStmt of imports) {
    for (const binding of importBindings(importStmt)) {
      names.type.add(binding.localName);
      if (!binding.typeOnly) names.value.add(binding.localName);
    }
  }
  return names;
}

function sameNode(a: SgNode | null, b: SgNode): boolean {
  if (!a) return false;
  const ar = a.range();
  const br = b.range();
  return (
    a.kind() === b.kind() && ar.start.index === br.start.index && ar.end.index === br.end.index
  );
}

function nearestReviewScope(node: SgNode | null): SgNode | null {
  let current = node;
  while (current) {
    if (REVIEW_SCOPE_KINDS.has(current.kind())) return current;
    current = current.parent();
  }
  return null;
}

function bindingIncludesName(node: SgNode, name: string): boolean {
  const names = new Set<string>();
  collectBindingNames(node, names);
  return names.has(name);
}

function hasAncestorBeforeScope(node: SgNode, scope: SgNode, kinds: Set<string>): boolean {
  let current = node.parent();
  while (current && !sameNode(current, scope)) {
    if (kinds.has(current.kind())) return true;
    current = current.parent();
  }
  return false;
}

function hasDeclarationReferenceAncestor(node: SgNode): boolean {
  let current = node.parent();
  while (current) {
    if (REVIEW_DECLARATION_REFERENCE_ANCESTOR_KINDS.has(current.kind())) return true;
    current = current.parent();
  }
  return false;
}

function forBindingChildren(loop: SgNode): SgNode[] {
  const children = loop.children();

  if (loop.kind() === "for_statement") {
    return children.filter((child) => REVIEW_FOR_BINDING_DECLARATION_KINDS.has(child.kind()));
  }

  const keywordIndex = children.findIndex(
    (child) => child.kind() === "in" || child.kind() === "of",
  );
  return keywordIndex === -1 ? [] : children.slice(0, keywordIndex);
}

function scopeHasValueBinding(scope: SgNode, name: string): boolean {
  for (const decl of scope.findAll({ rule: { kind: "variable_declarator" } })) {
    if (!sameNode(nearestReviewScope(decl.parent()), scope)) continue;
    if (hasAncestorBeforeScope(decl, scope, REVIEW_FOR_KINDS)) continue;
    const binding = firstDeclaratorChild(decl);
    if (binding && bindingIncludesName(binding, name)) return true;
  }

  for (const param of scope.findAll({
    rule: { any: [{ kind: "required_parameter" }, { kind: "optional_parameter" }] },
  })) {
    if (!sameNode(nearestReviewScope(param.parent()), scope)) continue;
    const binding = param
      .children()
      .find((child) =>
        ["identifier", "object_pattern", "array_pattern", "rest_pattern"].includes(child.kind()),
      );
    if (binding && bindingIncludesName(binding, name)) return true;
  }

  if (scope.kind() === "arrow_function") {
    const arrowIndex = scope.children().findIndex((child) => child.kind() === "=>");
    if (arrowIndex !== -1) {
      for (const child of scope.children().slice(0, arrowIndex)) {
        if (
          !["array_pattern", "identifier", "object_pattern", "rest_pattern"].includes(child.kind())
        ) {
          continue;
        }
        if (bindingIncludesName(child, name)) return true;
      }
    }
  }

  for (const decl of scope.findAll({
    rule: { any: REVIEW_VALUE_DECLARATION_KINDS.map((kind) => ({ kind })) },
  })) {
    if (!sameNode(nearestReviewScope(decl.parent()), scope)) continue;
    const binding = decl
      .children()
      .find((child) => child.kind() === "identifier" || child.kind() === "type_identifier");
    if (binding && bindingIncludesName(binding, name)) return true;
  }

  return false;
}

function scopeHasTypeBinding(scope: SgNode, name: string): boolean {
  for (const decl of scope.findAll({
    rule: { any: REVIEW_TYPE_DECLARATION_KINDS.map((kind) => ({ kind })) },
  })) {
    if (!sameNode(nearestReviewScope(decl.parent()), scope)) continue;
    const binding = decl
      .children()
      .find((child) => child.kind() === "identifier" || child.kind() === "type_identifier");
    if (binding && bindingIncludesName(binding, name)) return true;
  }
  return false;
}

function ancestorHasValueBinding(node: SgNode, name: string): boolean {
  let current = node.parent();
  while (current) {
    if (current.kind() === "catch_clause") {
      for (const child of current.children()) {
        if (["identifier", "object_pattern", "array_pattern"].includes(child.kind())) {
          if (bindingIncludesName(child, name)) return true;
        }
      }
    }

    if (REVIEW_FOR_KINDS.has(current.kind())) {
      for (const child of forBindingChildren(current)) {
        if (bindingIncludesName(child, name)) return true;
      }
    }

    current = current.parent();
  }
  return false;
}

function reviewNodeBindingNamespace(node: SgNode): BindingNamespace {
  return node.kind() === "nested_type_identifier" || node.kind() === "type_identifier"
    ? "type"
    : "value";
}

function hasRuntimeBindingInScope(
  node: SgNode,
  rootName: string,
  importedNames: RuntimeBindingNames,
): boolean {
  const namespace = reviewNodeBindingNamespace(node);
  if (importedNames[namespace].has(rootName)) return true;
  if (namespace === "value" && ancestorHasValueBinding(node, rootName)) return true;

  let scope = nearestReviewScope(node);
  while (scope) {
    if (namespace === "value" && scopeHasValueBinding(scope, rootName)) return true;
    if (namespace === "type" && scopeHasTypeBinding(scope, rootName)) return true;
    scope = nearestReviewScope(scope.parent());
  }
  return false;
}

function collectStringRuntimeGlobalFindings(
  root: SgNode,
  source: string,
  file: string,
  findings: LlmReviewFinding[],
  seen: Set<string>,
): void {
  for (const fragment of root.findAll({ rule: { kind: "string_fragment" } })) {
    const startLine = fragment.range().start.line + 1;
    const lines = fragment.text().split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!runtimeGlobalTextPattern.test(line)) continue;
      const context = i === 0 ? line : `${lines[i - 1]}\n${line}`;
      if (!matchesRuntimeGlobalsSourceString(context)) continue;
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
  importedNames: RuntimeBindingNames,
  findings: LlmReviewFinding[],
  seen: Set<string>,
): void {
  for (const node of root.findAll({
    rule: { any: [...REVIEW_NODE_KINDS].map((kind) => ({ kind })) },
  })) {
    if (hasDeclarationReferenceAncestor(node)) continue;
    const nodeText = node.text();
    const rootName = runtimeRootName(nodeText);
    if (!rootName || hasRuntimeBindingInScope(node, rootName, importedNames)) continue;
    if (!runtimeGlobalTextPattern.test(nodeText)) continue;
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
  if (!runtimeGlobalTextPattern.test(source)) return [];

  let root: SgNode;
  try {
    root = parse(sourceLang(filePath, source), source).root();
  } catch {
    return [];
  }

  const findings: LlmReviewFinding[] = [];
  const seen = new Set<string>();
  const imports = findImportStatements(root);
  collectDirectRuntimeGlobalFindings(
    root,
    source,
    relativePath,
    importedRuntimeNames(imports),
    findings,
    seen,
  );
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
