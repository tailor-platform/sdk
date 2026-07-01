import { parse, Lang } from "@ast-grep/napi";
import {
  globalRuntimeRootTextPattern,
  matchesRuntimeGlobalsSourceString,
  runtimeGlobalTextPattern,
} from "../../../../src/runtime-globals-patterns";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const RUNTIME_MODULE = "@tailor-platform/sdk/runtime";
const TAILOR_IDP_CLIENT = "tailor.idp.Client";
const RUNTIME_ROOT_NAME_PATTERN = String.raw`(tailor|tailordb|Tailor(?:DBFileError|Errors|ErrorMessage|ErrorItem))`;
const GLOBAL_OBJECT_REFERENCE_PATTERN = String.raw`(?:(globalThis|global)\s*(?:!\s*)?(?:(?:as|satisfies)\s+[^)]+)?|\(+\s*(?:<[^>]+>\s*)?(?:\(+\s*)?(globalThis|global)\s*(?:\)+\s*)?(?:!\s*)?(?:(?:as|satisfies)\s+[^)]+)?\s*\)+)`;
const BARE_RUNTIME_ROOT_TEXT_PATTERN = /\b(?:tailor|tailordb)\b/;
const RUNTIME_ROOT_PROPERTY_NAMES = new Set([
  "tailor",
  "tailordb",
  "TailorDBFileError",
  "TailorErrors",
  "TailorErrorMessage",
  "TailorErrorItem",
]);
const NON_ARGUMENT_KINDS = new Set(["(", ")", ",", "comment"]);
const REVIEW_TAILOR_RUNTIME_MEMBERS = new Set([
  "authconnection",
  "context",
  "iconv",
  "idp",
  "secretmanager",
  "workflow",
]);
const REVIEW_TAILORDB_RUNTIME_MEMBERS = new Set(["Client", "CommandType", "QueryResult", "file"]);
const REVIEW_NODE_KINDS = new Set([
  "member_expression",
  "identifier",
  "nested_identifier",
  "nested_type_identifier",
  "shorthand_property_identifier",
  "subscript_expression",
  "type_identifier",
]);
const REVIEW_SCOPE_KINDS = new Set([
  "program",
  "statement_block",
  "switch_body",
  "function_declaration",
  "generator_function_declaration",
  "function_expression",
  "generator_function",
  "arrow_function",
  "method_definition",
  "class",
  "internal_module",
  "class_static_block",
]);
const REVIEW_VALUE_PARAMETER_SCOPE_KINDS = new Set([
  "function_declaration",
  "generator_function_declaration",
  "function_expression",
  "generator_function",
  "arrow_function",
  "method_definition",
]);
const REVIEW_VALUE_DECLARATION_KINDS = [
  "function_declaration",
  "generator_function_declaration",
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
  "assignment_pattern",
  "object_assignment_pattern",
  "optional_parameter",
  "required_parameter",
  "variable_declarator",
]);
const REVIEW_TYPE_PARAMETER_CONTAINER_KINDS = new Set([
  "call_signature",
  "construct_signature",
  "constructor_type",
  "function_type",
  "method_signature",
]);
const REVIEW_DECLARATION_REFERENCE_ANCESTOR_KINDS = new Set(["import_statement"]);
const REVIEW_FOR_BINDING_DECLARATION_KINDS = new Set([
  "lexical_declaration",
  "variable_declaration",
]);
const REVIEW_FOR_BINDING_KEYWORD_KINDS = new Set(["const", "let", "var"]);
const REVIEW_FOR_KINDS = new Set(["for_statement", "for_in_statement"]);
const REVIEW_VAR_SCOPE_KINDS = new Set([
  "program",
  "function_declaration",
  "generator_function_declaration",
  "function_expression",
  "generator_function",
  "arrow_function",
  "method_definition",
  "internal_module",
  "class_static_block",
]);

type BindingNamespace = "type" | "value";

interface RuntimeBindingNames {
  type: Set<string>;
  value: Set<string>;
}

interface RuntimeRootReference {
  rootName: string;
  globalObjectName?: string;
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

function isJsLikeFile(filePath: string): boolean {
  return [".js", ".mjs", ".cjs"].some((ext) => filePath.endsWith(ext));
}

function looksLikeJsx(source: string): boolean {
  return source.includes("</") || /<[A-Za-z][\w.:-]*(?=[\s/>])[\s\S]*?\/>/.test(source);
}

function sourceLang(filePath: string, source: string): Lang {
  return filePath.endsWith(".tsx") ||
    filePath.endsWith(".jsx") ||
    (isJsLikeFile(filePath) && looksLikeJsx(source))
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
    if (child.kind() === "property_identifier" || child.kind() === "computed_property_name") {
      continue;
    }
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
    if (!valueParameterScope(param)) continue;
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
        { kind: "generator_function_declaration" },
        { kind: "function_expression" },
        { kind: "generator_function" },
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

function subtreeHasIdentifier(node: SgNode, name: string): boolean {
  return node.findAll({ rule: { kind: "identifier" } }).some((id) => id.text() === name);
}

function bindingExpressionReferencesName(root: SgNode, name: string): boolean {
  for (const computed of root.findAll({ rule: { kind: "computed_property_name" } })) {
    if (subtreeHasIdentifier(computed, name)) return true;
  }

  for (const assignment of root.findAll({
    rule: { any: [{ kind: "assignment_pattern" }, { kind: "object_assignment_pattern" }] },
  })) {
    const children = assignment.children();
    const equalsIndex = children.findIndex((child) => child.kind() === "=");
    if (equalsIndex === -1) continue;
    if (children.slice(equalsIndex + 1).some((child) => subtreeHasIdentifier(child, name))) {
      return true;
    }
  }

  return false;
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

function runtimeRootReference(source: string): RuntimeRootReference | null {
  const globalObjectMatch = new RegExp(
    String.raw`^\s*${GLOBAL_OBJECT_REFERENCE_PATTERN}\s*(?:\.|\?\.|!\s*\.)${RUNTIME_ROOT_NAME_PATTERN}\b`,
  ).exec(source);
  if (globalObjectMatch) {
    return {
      rootName: globalObjectMatch[3]!,
      globalObjectName: globalObjectMatch[1] ?? globalObjectMatch[2]!,
    };
  }

  const globalObjectBracketMatch = new RegExp(
    String.raw`^\s*${GLOBAL_OBJECT_REFERENCE_PATTERN}\s*(?:\?\.|!\s*)?\[\s*["']${RUNTIME_ROOT_NAME_PATTERN}["']\s*\]`,
  ).exec(source);
  if (globalObjectBracketMatch) {
    return {
      rootName: globalObjectBracketMatch[3]!,
      globalObjectName: globalObjectBracketMatch[1] ?? globalObjectBracketMatch[2]!,
    };
  }

  const parenthesizedMatch =
    /^\s*\(+\s*(?:<[^>]+>\s*)?(tailor|tailordb|Tailor(?:DBFileError|Errors|ErrorMessage|ErrorItem))\s*(?:!\s*)?(?:(?:as|satisfies)\s+[^)]+)?\)+/.exec(
      source,
    );
  if (parenthesizedMatch) {
    return { rootName: parenthesizedMatch[1]! };
  }

  const bareMatch =
    /^\s*(tailor|tailordb|Tailor(?:DBFileError|Errors|ErrorMessage|ErrorItem))\b/.exec(source);
  return bareMatch ? { rootName: bareMatch[1]! } : null;
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

function valueParameterScope(param: SgNode): SgNode | null {
  const scope = nearestReviewScope(param.parent());
  if (!scope || !REVIEW_VALUE_PARAMETER_SCOPE_KINDS.has(scope.kind())) return null;
  if (hasAncestorBeforeScope(param, scope, REVIEW_TYPE_PARAMETER_CONTAINER_KINDS)) return null;
  return scope;
}

function nearestVarReviewScope(node: SgNode | null): SgNode | null {
  let current = node;
  while (current) {
    if (REVIEW_VAR_SCOPE_KINDS.has(current.kind())) return current;
    current = current.parent();
  }
  return null;
}

function isVarDeclarator(decl: SgNode): boolean {
  return (
    decl
      .parent()
      ?.children()
      .some((child) => child.kind() === "var") ?? false
  );
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
    if (current.kind() === "export_clause" || current.kind() === "export_specifier") {
      let exportParent = current.parent();
      while (exportParent && exportParent.kind() !== "export_statement") {
        exportParent = exportParent.parent();
      }
      return exportParent?.children().some((child) => child.kind() === "from") ?? false;
    }
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
  if (keywordIndex === -1) return [];

  const beforeKeyword = children.slice(0, keywordIndex);
  return beforeKeyword.some((child) => REVIEW_FOR_BINDING_KEYWORD_KINDS.has(child.kind()))
    ? beforeKeyword
    : [];
}

function scopeHasImportBinding(scope: SgNode, name: string, namespace: BindingNamespace): boolean {
  for (const importStmt of scope.findAll({ rule: { kind: "import_statement" } })) {
    if (!sameNode(nearestReviewScope(importStmt.parent()), scope)) continue;
    for (const binding of importBindings(importStmt)) {
      if (binding.localName !== name) continue;
      if (namespace === "type" || !binding.typeOnly) return true;
    }
  }
  return false;
}

function scopeHasValueBinding(scope: SgNode, name: string): boolean {
  if (scope.kind() === "function_expression" || scope.kind() === "generator_function") {
    const functionName = scope.children().find((child) => child.kind() === "identifier");
    if (functionName?.text() === name) return true;
  }

  if (scope.kind() === "class") {
    const className = scope.children().find((child) => child.kind() === "type_identifier");
    if (className?.text() === name) return true;
  }

  if (scopeHasImportBinding(scope, name, "value")) return true;

  for (const decl of scope.findAll({ rule: { kind: "variable_declarator" } })) {
    const varDeclarator = isVarDeclarator(decl);
    const declarationScope = varDeclarator
      ? nearestVarReviewScope(decl.parent())
      : nearestReviewScope(decl.parent());
    if (!sameNode(declarationScope, scope)) continue;
    if (!varDeclarator && hasAncestorBeforeScope(decl, scope, REVIEW_FOR_KINDS)) continue;
    const binding = firstDeclaratorChild(decl);
    if (binding && bindingIncludesName(binding, name)) return true;
  }

  for (const param of scope.findAll({
    rule: { any: [{ kind: "required_parameter" }, { kind: "optional_parameter" }] },
  })) {
    if (!sameNode(valueParameterScope(param), scope)) continue;
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
  if (scopeHasImportBinding(scope, name, "type")) return true;

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

function hasTypeParameterBinding(node: SgNode, name: string): boolean {
  const typeParameters = node.children().find((child) => child.kind() === "type_parameters");
  if (typeParameters) {
    for (const typeParameter of typeParameters.findAll({ rule: { kind: "type_parameter" } })) {
      const binding = typeParameter
        .children()
        .find((child) => child.kind() === "identifier" || child.kind() === "type_identifier");
      if (binding?.text() === name) return true;
    }
  }

  const inferType =
    node.kind() === "infer_type"
      ? node
      : node.children().find((child) => child.kind() === "infer_type");
  const inferBinding = inferType?.children().find((child) => child.kind() === "type_identifier");
  if (inferBinding?.text() === name) return true;

  const mappedType =
    node.kind() === "mapped_type_clause"
      ? node
      : node.children().find((child) => child.kind() === "mapped_type_clause");
  const mappedBinding = mappedType?.children().find((child) => child.kind() === "type_identifier");
  return mappedBinding?.text() === name;
}

function ancestorHasTypeBinding(node: SgNode, name: string): boolean {
  let current = node.parent();
  while (current) {
    if (hasTypeParameterBinding(current, name)) return true;
    current = current.parent();
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

function isInTypeOnlyExportStatement(node: SgNode): boolean {
  let current = node.parent();
  while (current) {
    if (current.kind() === "export_specifier") {
      if (current.children().some((child) => child.kind() === "type")) return true;
    }
    if (current.kind() === "export_statement") {
      return current.children().some((child) => child.kind() === "type");
    }
    current = current.parent();
  }
  return false;
}

function hasAncestorKind(node: SgNode, kind: string): boolean {
  let current = node.parent();
  while (current) {
    if (current.kind() === kind) return true;
    current = current.parent();
  }
  return false;
}

function reviewNodeBindingNamespace(node: SgNode): BindingNamespace {
  if (node.kind() === "identifier" && isInTypeOnlyExportStatement(node)) return "type";
  return node.kind() === "nested_type_identifier" ||
    node.kind() === "type_identifier" ||
    hasAncestorKind(node, "nested_type_identifier")
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
  if (namespace === "type" && ancestorHasTypeBinding(node, rootName)) return true;

  let scope = nearestReviewScope(node);
  while (scope) {
    if (namespace === "value" && scopeHasValueBinding(scope, rootName)) return true;
    if (namespace === "type" && scopeHasTypeBinding(scope, rootName)) return true;
    scope = nearestReviewScope(scope.parent());
  }
  return false;
}

function runtimeIndexedTypeMember(rootName: string, member: string): boolean {
  if (rootName === "tailor") return REVIEW_TAILOR_RUNTIME_MEMBERS.has(member);
  if (rootName === "tailordb") return REVIEW_TAILORDB_RUNTIME_MEMBERS.has(member);
  return false;
}

function indexedTypeQueryMember(node: SgNode, rootName: string): string | null {
  if (node.kind() !== "identifier") return null;
  if (rootName !== "tailor" && rootName !== "tailordb") return null;

  let current = node.parent();
  let hasTypeQuery = false;
  while (current && current.kind() !== "lookup_type") {
    if (current.kind() === "type_query") hasTypeQuery = true;
    current = current.parent();
  }
  if (!current || !hasTypeQuery) return null;

  const index = current.children().find((child) => child.kind() === "literal_type");
  const member = stringValue(index ?? null);
  if (!member) return "*";
  return runtimeIndexedTypeMember(rootName, member) ? member : null;
}

function isNestedTypeIdentifierChild(node: SgNode): boolean {
  return (
    node.kind() !== "nested_type_identifier" && hasAncestorKind(node, "nested_type_identifier")
  );
}

function nodeChildIndex(parent: SgNode, node: SgNode): number {
  return parent.children().findIndex((child) => sameNode(child, node));
}

function appearsAfterEquals(parent: SgNode, node: SgNode): boolean {
  const nodeIndex = nodeChildIndex(parent, node);
  const equalsIndex = parent.children().findIndex((child) => child.kind() === "=");
  return nodeIndex !== -1 && equalsIndex !== -1 && nodeIndex > equalsIndex;
}

function isParameterBindingIdentifier(parent: SgNode, node: SgNode): boolean {
  if (parent.kind() !== "required_parameter" && parent.kind() !== "optional_parameter") {
    return false;
  }
  const binding = parent
    .children()
    .find((child) =>
      ["identifier", "object_pattern", "array_pattern", "rest_pattern"].includes(child.kind()),
    );
  return sameNode(binding ?? null, node);
}

function isForAssignmentTarget(node: SgNode): boolean {
  const parent = node.parent();
  if (!parent || !REVIEW_FOR_KINDS.has(parent.kind())) return false;
  const nodeIndex = nodeChildIndex(parent, node);
  const keywordIndex = parent
    .children()
    .findIndex((child) => child.kind() === "in" || child.kind() === "of");
  return nodeIndex !== -1 && keywordIndex !== -1 && nodeIndex < keywordIndex;
}

function isBindingIdentifier(node: SgNode): boolean {
  const parent = node.parent();
  if (!parent) return false;
  if (isParameterBindingIdentifier(parent, node)) return true;
  if (parent.kind() === "variable_declarator") {
    return sameNode(firstDeclaratorChild(parent), node);
  }
  return false;
}

function isBareRuntimeRootValueReference(node: SgNode, rootName: string): boolean {
  if (!["identifier", "shorthand_property_identifier"].includes(node.kind())) return false;
  if (node.text() !== rootName) return false;
  if (rootName !== "tailor" && rootName !== "tailordb") return false;
  if (isBindingIdentifier(node) || isForAssignmentTarget(node)) return false;

  const parent = node.parent();
  if (!parent) return false;
  if (parent.kind() === "assignment_expression") return true;
  if (parent.kind() === "variable_declarator") {
    return appearsAfterEquals(parent, node);
  }
  if (parent.kind() === "assignment_pattern" || parent.kind() === "object_assignment_pattern") {
    return appearsAfterEquals(parent, node);
  }
  return true;
}

function declaratorInitializer(node: SgNode): SgNode | null {
  const children = node.children();
  const equalsIndex = children.findIndex((child) => child.kind() === "=");
  return equalsIndex === -1 ? null : (children[equalsIndex + 1] ?? null);
}

function globalObjectReferenceName(node: SgNode | null): string | null {
  const text = node?.text() ?? "";
  const match = new RegExp(String.raw`^\s*${GLOBAL_OBJECT_REFERENCE_PATTERN}(?:!\s*)?\s*$`).exec(
    text,
  );
  return match ? (match[1] ?? match[2]!) : null;
}

function literalPropertyKeyName(node: SgNode): string | null {
  if (
    node.kind() === "property_identifier" ||
    node.kind() === "shorthand_property_identifier_pattern"
  ) {
    return node.text();
  }

  const stringMatch = /^\s*["']([^"']+)["']\s*$/.exec(node.text());
  if (node.kind() === "string" && stringMatch) return stringMatch[1]!;

  const computedStringMatch = /^\[\s*["']([^"']+)["']\s*\]$/.exec(node.text());
  if (node.kind() === "computed_property_name" && computedStringMatch) {
    return computedStringMatch[1]!;
  }

  return null;
}

function objectPatternPropertyKeyName(node: SgNode): string | null {
  const directName = literalPropertyKeyName(node);
  if (directName) return directName;

  if (node.kind() !== "pair_pattern" && node.kind() !== "object_assignment_pattern") {
    return null;
  }

  for (const child of node.children()) {
    if (child.kind() === ":" || child.kind() === "=") return null;
    const name = literalPropertyKeyName(child);
    if (name) return name;
  }

  return null;
}

function hasRuntimeRootObjectPatternKey(binding: SgNode | null): boolean {
  if (!binding || binding.kind() !== "object_pattern") return false;

  return binding
    .children()
    .some((child) => RUNTIME_ROOT_PROPERTY_NAMES.has(objectPatternPropertyKeyName(child) ?? ""));
}

function collectGlobalObjectDestructureFinding(
  node: SgNode,
  binding: SgNode | null,
  init: SgNode | null,
  source: string,
  file: string,
  importedNames: RuntimeBindingNames,
  findings: LlmReviewFinding[],
  seen: Set<string>,
): void {
  if (!hasRuntimeRootObjectPatternKey(binding)) return;

  const globalObjectName = globalObjectReferenceName(init);
  if (!globalObjectName) return;
  if (init && hasRuntimeBindingInScope(init, globalObjectName, importedNames)) return;

  addReviewFinding(
    findings,
    seen,
    source,
    file,
    node.range().start.line + 1,
    "Tailor runtime global reference remains after automatic migration.",
  );
}

function collectGlobalObjectDestructureFindings(
  root: SgNode,
  source: string,
  file: string,
  importedNames: RuntimeBindingNames,
  findings: LlmReviewFinding[],
  seen: Set<string>,
): void {
  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    collectGlobalObjectDestructureFinding(
      decl,
      firstDeclaratorChild(decl),
      declaratorInitializer(decl),
      source,
      file,
      importedNames,
      findings,
      seen,
    );
  }

  for (const assignment of root.findAll({ rule: { kind: "assignment_expression" } })) {
    collectGlobalObjectDestructureFinding(
      assignment,
      firstDeclaratorChild(assignment),
      declaratorInitializer(assignment),
      source,
      file,
      importedNames,
      findings,
      seen,
    );
  }

  for (const assignmentPattern of root.findAll({ rule: { kind: "assignment_pattern" } })) {
    collectGlobalObjectDestructureFinding(
      assignmentPattern,
      firstDeclaratorChild(assignmentPattern),
      declaratorInitializer(assignmentPattern),
      source,
      file,
      importedNames,
      findings,
      seen,
    );
  }

  for (const param of root.findAll({
    rule: { any: [{ kind: "required_parameter" }, { kind: "optional_parameter" }] },
  })) {
    collectGlobalObjectDestructureFinding(
      param,
      firstDeclaratorChild(param),
      declaratorInitializer(param),
      source,
      file,
      importedNames,
      findings,
      seen,
    );
  }
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
      const hasRuntimeGlobal = runtimeGlobalTextPattern.test(line);
      const hasGlobalRuntimeRoot = globalRuntimeRootTextPattern.test(line);
      const hasBareRuntimeRoot = BARE_RUNTIME_ROOT_TEXT_PATTERN.test(line);
      if (!hasRuntimeGlobal && !hasGlobalRuntimeRoot && !hasBareRuntimeRoot) {
        continue;
      }
      if (!hasRuntimeGlobal && !hasGlobalRuntimeRoot && /^(?:tailor|tailordb)$/.test(line.trim())) {
        continue;
      }
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
    if (isNestedTypeIdentifierChild(node)) continue;
    const nodeText = node.text();
    const rootRef = runtimeRootReference(nodeText);
    if (!rootRef) continue;
    if (
      rootRef.globalObjectName &&
      hasRuntimeBindingInScope(node, rootRef.globalObjectName, importedNames)
    ) {
      continue;
    }
    if (
      !rootRef.globalObjectName &&
      hasRuntimeBindingInScope(node, rootRef.rootName, importedNames)
    ) {
      continue;
    }
    if (
      !rootRef.globalObjectName &&
      !runtimeGlobalTextPattern.test(nodeText) &&
      !indexedTypeQueryMember(node, rootRef.rootName) &&
      !isBareRuntimeRootValueReference(node, rootRef.rootName)
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
  if (
    !runtimeGlobalTextPattern.test(source) &&
    !globalRuntimeRootTextPattern.test(source) &&
    !BARE_RUNTIME_ROOT_TEXT_PATTERN.test(source)
  ) {
    return [];
  }

  let root: SgNode;
  try {
    root = parse(sourceLang(filePath, source), source).root();
  } catch {
    return [];
  }

  const findings: LlmReviewFinding[] = [];
  const seen = new Set<string>();
  const imports = findImportStatements(root);
  const importedNames = importedRuntimeNames(imports);
  collectDirectRuntimeGlobalFindings(root, source, relativePath, importedNames, findings, seen);
  collectGlobalObjectDestructureFindings(root, source, relativePath, importedNames, findings, seen);
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
  const localNames = localDeclarationNames(root);
  if (existingIdpLocal === null && bindingExpressionReferencesName(root, "idp")) {
    localNames.add("idp");
  }
  if (hasCollision(imports, localNames, idpLocal, existingIdpLocal === null)) {
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
