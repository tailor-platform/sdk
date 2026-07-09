import { parse, Lang } from "@ast-grep/napi";
import {
  collectBindingNames,
  findImportStatements,
  importBindings,
  importSource,
  importSpecNames,
  isTypeOnlyImport,
  localDeclarationNames,
} from "../../../../src/ast-grep-helpers";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

interface RuntimeModule {
  namespace: string;
  source: string;
  members: Record<string, string>;
}

interface FlatImport {
  localName: string;
  memberName: string;
  typeOnly: boolean;
}

interface ImportReplacement {
  edit: Edit;
  flatImports: FlatImport[];
  namespaceLocal: string;
}

interface SelfNamespaceImport {
  localName: string;
  typeOnly: boolean;
}

const RUNTIME_MODULES: RuntimeModule[] = [
  {
    namespace: "iconv",
    source: "@tailor-platform/sdk/runtime/iconv",
    members: {
      convert: "convert",
      convertBuffer: "convertBuffer",
      decode: "decode",
      encode: "encode",
      encodings: "encodings",
      Iconv: "Iconv",
    },
  },
  {
    namespace: "secretmanager",
    source: "@tailor-platform/sdk/runtime/secretmanager",
    members: { getSecrets: "getSecrets", getSecret: "getSecret" },
  },
  {
    namespace: "authconnection",
    source: "@tailor-platform/sdk/runtime/authconnection",
    members: { getConnectionToken: "getConnectionToken" },
  },
  {
    namespace: "idp",
    source: "@tailor-platform/sdk/runtime/idp",
    members: { Client: "Client" },
  },
  {
    namespace: "workflow",
    source: "@tailor-platform/sdk/runtime/workflow",
    members: {
      triggerWorkflow: "triggerWorkflow",
      resumeWorkflow: "resumeWorkflow",
      triggerJobFunction: "triggerJobFunction",
      wait: "wait",
      resolve: "resolve",
    },
  },
  {
    namespace: "context",
    source: "@tailor-platform/sdk/runtime/context",
    members: { getInvoker: "getInvoker" },
  },
  {
    namespace: "file",
    source: "@tailor-platform/sdk/runtime/file",
    members: {
      upload: "upload",
      download: "download",
      downloadAsBase64: "downloadAsBase64",
      delete: "delete",
      deleteFile: "delete",
      getMetadata: "getMetadata",
      downloadStream: "downloadStream",
      uploadStream: "uploadStream",
    },
  },
  {
    namespace: "aigateway",
    source: "@tailor-platform/sdk/runtime/aigateway",
    members: { get: "get" },
  },
];

const MODULES_BY_SOURCE = new Map(RUNTIME_MODULES.map((mod) => [mod.source, mod]));
const JSX_FILE_EXTENSIONS = new Set([".tsx", ".jsx"]);
const JS_FILE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

function quickFilter(source: string): boolean {
  return source.includes("@tailor-platform/sdk/runtime/");
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

function importClause(importStmt: SgNode): SgNode | null {
  return importStmt.children().find((child) => child.kind() === "import_clause") ?? null;
}

function defaultImportName(importStmt: SgNode): string | null {
  return (
    importClause(importStmt)
      ?.children()
      .find((child) => child.kind() === "identifier")
      ?.text() ?? null
  );
}

function namespaceImportName(importStmt: SgNode): string | null {
  return (
    importClause(importStmt)
      ?.children()
      .find((child) => child.kind() === "namespace_import")
      ?.children()
      .find((child) => child.kind() === "identifier")
      ?.text() ?? null
  );
}

function formatImport(
  source: string,
  defaultName: string | null,
  namedSpecs: string[],
  typeOnly = false,
): string {
  const importKeyword = typeOnly ? "import type" : "import";
  const named = namedSpecs.length > 0 ? `{ ${namedSpecs.join(", ")} }` : null;
  if (defaultName && named) return `${importKeyword} ${defaultName}, ${named} from "${source}";`;
  if (defaultName) return `${importKeyword} ${defaultName} from "${source}";`;
  if (named) return `${importKeyword} ${named} from "${source}";`;
  return "";
}

function replaceImportStatement(importStmt: SgNode, nextText: string, sourceText: string): Edit {
  if (nextText !== "") return importStmt.replace(nextText);

  const range = importStmt.range();
  let endPos = range.end.index;
  if (sourceText[endPos] === "\r" && sourceText[endPos + 1] === "\n") {
    endPos += 2;
  } else if (sourceText[endPos] === "\n") {
    endPos += 1;
  }
  return { startPos: range.start.index, endPos, insertedText: "" };
}

function isInsideImportStatement(node: SgNode): boolean {
  let current = node.parent();
  while (current) {
    if (current.kind() === "import_statement") return true;
    current = current.parent();
  }
  return false;
}

function isInsideExportSpecifier(node: SgNode): boolean {
  let current = node.parent();
  while (current) {
    if (current.kind() === "export_specifier") return true;
    if (current.kind() === "export_statement") return false;
    current = current.parent();
  }
  return false;
}

function isInsideTypeQuery(node: SgNode): boolean {
  let current = node.parent();
  while (current) {
    if (current.kind() === "type_query") return true;
    if (current.kind() === "statement_block" || current.kind() === "program") return false;
    current = current.parent();
  }
  return false;
}

function isJsxTagName(node: SgNode): boolean {
  const parentKind = node.parent()?.kind();
  return (
    parentKind === "jsx_opening_element" ||
    parentKind === "jsx_self_closing_element" ||
    parentKind === "jsx_closing_element"
  );
}

function sameNode(left: SgNode | null | undefined, right: SgNode): boolean {
  if (!left) return false;
  const leftRange = left.range();
  const rightRange = right.range();
  return (
    leftRange.start.index === rightRange.start.index && leftRange.end.index === rightRange.end.index
  );
}

function typeParameterName(typeParameter: SgNode): SgNode | null {
  return typeParameter.children().find((child) => child.kind() === "type_identifier") ?? null;
}

function typeParametersDeclare(typeParameters: SgNode, name: string): boolean {
  return typeParameters
    .children()
    .some(
      (child) => child.kind() === "type_parameter" && typeParameterName(child)?.text() === name,
    );
}

function isTypeParameterScoped(node: SgNode): boolean {
  let current = node.parent();
  while (current) {
    if (current.kind() === "type_parameter" && sameNode(typeParameterName(current), node)) {
      return true;
    }

    const typeParameters = current.children().find((child) => child.kind() === "type_parameters");
    if (typeParameters && typeParametersDeclare(typeParameters, node.text())) return true;

    current = current.parent();
  }
  return false;
}

function isNestedTypeMember(node: SgNode): boolean {
  const parent = node.parent();
  if (parent?.kind() !== "nested_type_identifier") return false;

  const firstNamedChild = parent
    .children()
    .find((child) => child.kind() === "identifier" || child.kind() === "type_identifier");
  return !sameNode(firstNamedChild, node);
}

function localTypeScopeDeclarationNames(root: SgNode): Set<string> {
  const names = new Set<string>();
  for (const node of root.findAll({
    rule: {
      any: [{ kind: "type_parameter" }, { kind: "infer_type" }, { kind: "mapped_type_clause" }],
    },
  })) {
    const name = node.children().find((child) => child.kind() === "type_identifier");
    if (name) names.add(name.text());
  }
  return names;
}

function hasExportSpecifierReference(root: SgNode, names: Set<string>): boolean {
  return root
    .findAll({ rule: { kind: "export_specifier" } })
    .some((specifier) =>
      specifier
        .children()
        .some((child) => child.kind() === "identifier" && names.has(child.text())),
    );
}

function findExportStatements(root: SgNode): SgNode[] {
  return root
    .findAll({ rule: { kind: "export_statement" } })
    .filter((stmt) => stmt.parent()?.kind() === "program")
    .toSorted((a, b) => a.range().start.index - b.range().start.index);
}

function usedNames(root: SgNode, imports: SgNode[], removedNames: Set<string>): Set<string> {
  const names = localDeclarationNames(root);
  for (const importStmt of imports) {
    for (const binding of importBindings(importStmt)) {
      if (!removedNames.has(binding.localName)) names.add(binding.localName);
    }
  }
  return names;
}

function uniqueNamespaceLocal(
  mod: RuntimeModule,
  root: SgNode,
  imports: SgNode[],
  removedNames: Set<string>,
): string {
  const names = usedNames(root, imports, removedNames);
  if (!names.has(mod.namespace)) return mod.namespace;

  const base = `${mod.namespace}Runtime`;
  if (!names.has(base)) return base;

  for (let i = 2; ; i++) {
    const candidate = `${base}${i}`;
    if (!names.has(candidate)) return candidate;
  }
}

function selfNamespaceSpec(mod: RuntimeModule, localName: string): string {
  return localName === mod.namespace ? mod.namespace : `${mod.namespace} as ${localName}`;
}

function typeOnlySelfNamespaceSpec(mod: RuntimeModule, localName: string): string {
  return `type ${selfNamespaceSpec(mod, localName)}`;
}

function existingSelfNamespaceImport(
  importStmt: SgNode,
  mod: RuntimeModule,
  statementTypeOnly: boolean,
): SelfNamespaceImport | null {
  for (const spec of importStmt.findAll({ rule: { kind: "import_specifier" } })) {
    const names = importSpecNames(spec);
    if (!names || names.importedName !== mod.namespace) continue;
    return { localName: names.localName, typeOnly: statementTypeOnly || names.typeOnly };
  }
  return null;
}

function flatImportsFor(importStmt: SgNode, mod: RuntimeModule): FlatImport[] {
  const statementTypeOnly = isTypeOnlyImport(importStmt);
  const flatImports: FlatImport[] = [];
  for (const spec of importStmt.findAll({ rule: { kind: "import_specifier" } })) {
    const names = importSpecNames(spec);
    if (!names) continue;
    const memberName = mod.members[names.importedName];
    if (!memberName) continue;
    flatImports.push({
      localName: names.localName,
      memberName,
      typeOnly: statementTypeOnly || names.typeOnly,
    });
  }
  return flatImports;
}

function plannedValueNamespaceLocal(
  importStmt: SgNode,
  mod: RuntimeModule,
  root: SgNode,
  imports: SgNode[],
): string | null {
  const source = importSource(importStmt);
  if (!source) return null;

  for (const candidate of imports) {
    if (sameNode(candidate, importStmt)) continue;
    if (importSource(candidate) !== source || isTypeOnlyImport(candidate)) continue;

    const namespaceName = namespaceImportName(candidate);
    if (namespaceName) return namespaceName;

    const defaultName = defaultImportName(candidate);
    if (defaultName) return defaultName;

    const existingSelf = existingSelfNamespaceImport(candidate, mod, false);
    if (existingSelf && !existingSelf.typeOnly) return existingSelf.localName;

    const valueFlatImports = flatImportsFor(candidate, mod).filter((binding) => !binding.typeOnly);
    if (valueFlatImports.length === 0) continue;

    const removedNames = new Set(valueFlatImports.map((binding) => binding.localName));
    const declaredNames = new Set([
      ...localDeclarationNames(root),
      ...localTypeScopeDeclarationNames(root),
    ]);
    if (valueFlatImports.some((binding) => declaredNames.has(binding.localName))) continue;
    if (hasExportSpecifierReference(root, removedNames)) continue;

    return uniqueNamespaceLocal(mod, root, imports, removedNames);
  }

  return null;
}

function buildImportReplacement(
  importStmt: SgNode,
  mod: RuntimeModule,
  root: SgNode,
  imports: SgNode[],
  sourceText: string,
  emittedNamespaceSpecifiers: Set<string>,
): ImportReplacement | null {
  const source = importSource(importStmt);
  if (!source) return null;

  const statementTypeOnly = isTypeOnlyImport(importStmt);
  const namespaceName = namespaceImportName(importStmt);
  if (namespaceName) {
    const edit = statementTypeOnly
      ? importStmt.replace(
          formatImport(source, null, [selfNamespaceSpec(mod, namespaceName)], true),
        )
      : importStmt.replace(formatImport(source, namespaceName, []));
    return {
      edit,
      flatImports: [],
      namespaceLocal: namespaceName,
    };
  }

  const defaultName = defaultImportName(importStmt);
  if (statementTypeOnly && defaultName) return null;

  const existingSelf = existingSelfNamespaceImport(importStmt, mod, statementTypeOnly);
  const flatImports: FlatImport[] = [];
  const keptSpecs: string[] = [];

  for (const spec of importStmt.findAll({ rule: { kind: "import_specifier" } })) {
    const names = importSpecNames(spec);
    if (!names) continue;

    const memberName = mod.members[names.importedName];
    if (memberName) {
      flatImports.push({
        localName: names.localName,
        memberName,
        typeOnly: statementTypeOnly || names.typeOnly,
      });
      continue;
    }

    keptSpecs.push(spec.text());
  }

  if (flatImports.length === 0) return null;

  const removedNames = new Set(flatImports.map((binding) => binding.localName));
  const declaredNames = new Set([
    ...localDeclarationNames(root),
    ...localTypeScopeDeclarationNames(root),
  ]);
  if (flatImports.some((binding) => declaredNames.has(binding.localName))) return null;
  if (hasExportSpecifierReference(root, removedNames)) return null;

  const flatImportsAreTypeOnly = flatImports.every((binding) => binding.typeOnly);
  const canUseExistingSelf =
    existingSelf != null && (!existingSelf.typeOnly || flatImportsAreTypeOnly);
  const plannedValueLocal = flatImportsAreTypeOnly
    ? plannedValueNamespaceLocal(importStmt, mod, root, imports)
    : null;
  const namespaceLocal =
    plannedValueLocal ??
    (!statementTypeOnly && defaultName
      ? defaultName
      : canUseExistingSelf
        ? existingSelf.localName
        : uniqueNamespaceLocal(mod, root, imports, removedNames));
  const namespaceSpecifierKey = [
    source,
    namespaceLocal,
    flatImportsAreTypeOnly ? "type" : "value",
  ].join("\0");
  const namespaceAlreadyEmitted = emittedNamespaceSpecifiers.has(namespaceSpecifierKey);
  const needsNamespaceSpecifier =
    plannedValueLocal == null &&
    !((!statementTypeOnly && defaultName) || canUseExistingSelf) &&
    !namespaceAlreadyEmitted;
  if (needsNamespaceSpecifier) emittedNamespaceSpecifiers.add(namespaceSpecifierKey);
  const namespaceSpecifier =
    flatImportsAreTypeOnly && !statementTypeOnly
      ? typeOnlySelfNamespaceSpec(mod, namespaceLocal)
      : selfNamespaceSpec(mod, namespaceLocal);
  const nextNamedSpecs = needsNamespaceSpecifier ? [namespaceSpecifier, ...keptSpecs] : keptSpecs;

  return {
    edit: replaceImportStatement(
      importStmt,
      formatImport(
        source,
        statementTypeOnly ? null : defaultName,
        nextNamedSpecs,
        statementTypeOnly,
      ),
      sourceText,
    ),
    flatImports,
    namespaceLocal,
  };
}

function referenceEdits(root: SgNode, replacements: ImportReplacement[]): Edit[] {
  const byLocalName = new Map<
    string,
    { namespaceLocal: string; memberName: string; typeOnly: boolean }
  >();
  for (const replacement of replacements) {
    for (const binding of replacement.flatImports) {
      byLocalName.set(binding.localName, {
        namespaceLocal: replacement.namespaceLocal,
        memberName: binding.memberName,
        typeOnly: binding.typeOnly,
      });
    }
  }

  const edits: Edit[] = [];
  const replacementFor = (name: string): string | null => {
    const binding = byLocalName.get(name);
    return binding ? `${binding.namespaceLocal}.${binding.memberName}` : null;
  };

  for (const node of root.findAll({ rule: { kind: "identifier" } })) {
    if (isInsideImportStatement(node)) continue;
    if (isInsideExportSpecifier(node)) continue;
    if (isJsxTagName(node)) continue;
    if (byLocalName.get(node.text())?.typeOnly && !isInsideTypeQuery(node)) continue;
    const replacement = replacementFor(node.text());
    if (!replacement) continue;
    edits.push(node.replace(replacement));
  }

  for (const node of root.findAll({ rule: { kind: "type_identifier" } })) {
    if (isInsideImportStatement(node)) continue;
    if (isInsideExportSpecifier(node)) continue;
    if (isTypeParameterScoped(node)) continue;
    if (isNestedTypeMember(node)) continue;
    const replacement = replacementFor(node.text());
    if (!replacement) continue;
    edits.push(node.replace(replacement));
  }

  for (const node of root.findAll({ rule: { kind: "shorthand_property_identifier" } })) {
    if (byLocalName.get(node.text())?.typeOnly) continue;
    const replacement = replacementFor(node.text());
    if (!replacement) continue;
    edits.push(node.replace(`${node.text()}: ${replacement}`));
  }
  return edits;
}

/**
 * Rewrite v1 runtime subpath imports to the v2 namespace object exports.
 * @param source - File contents
 * @param filePath - Absolute path to the file
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!quickFilter(source)) return null;

  const root = parse(sourceLang(filePath, source), source).root();
  const imports = findImportStatements(root);
  const replacements: ImportReplacement[] = [];
  const emittedNamespaceSpecifiers = new Set<string>();

  for (const importStmt of imports) {
    const sourceName = importSource(importStmt);
    if (!sourceName) continue;
    const mod = MODULES_BY_SOURCE.get(sourceName);
    if (!mod) continue;

    const replacement = buildImportReplacement(
      importStmt,
      mod,
      root,
      imports,
      source,
      emittedNamespaceSpecifiers,
    );
    if (replacement) replacements.push(replacement);
  }

  if (replacements.length === 0) return null;

  const edits = [
    ...replacements.map((replacement) => replacement.edit),
    ...referenceEdits(root, replacements),
  ];
  const result = root.commitEdits(edits);
  return result === source ? null : result;
}

function hasRemovedFlatSpecifier(node: SgNode, mod: RuntimeModule): boolean {
  return node
    .findAll({ rule: { any: [{ kind: "import_specifier" }, { kind: "export_specifier" }] } })
    .some((spec) => {
      const names = importSpecNames(spec);
      return names != null && mod.members[names.importedName] != null;
    });
}

function isExportStar(node: SgNode): boolean {
  if (node.children().some((child) => child.kind() === "*")) return true;
  const namespaceExport = node.children().find((child) => child.kind() === "namespace_export");
  return namespaceExport?.children().some((child) => child.kind() === "*") ?? false;
}

function literalModuleSource(node: SgNode): string | null {
  if (node.kind() === "string") return importSource(node);
  if (node.kind() !== "template_string") return null;
  if (node.children().some((child) => child.kind() === "template_substitution")) return null;

  const text = node.text();
  return text.startsWith("`") && text.endsWith("`") ? text.slice(1, -1) : null;
}

function isSourceScopeNode(node: SgNode): boolean {
  const kind = node.kind();
  return (
    kind === "program" ||
    kind === "statement_block" ||
    kind === "function_declaration" ||
    kind === "arrow_function" ||
    kind === "method_definition"
  );
}

function nearestSourceScope(node: SgNode): SgNode | null {
  let current = node.parent();
  while (current) {
    if (isSourceScopeNode(current)) return current;
    current = current.parent();
  }
  return null;
}

function sameRange(left: SgNode | null, right: SgNode): boolean {
  if (!left) return false;
  const leftRange = left.range();
  const rightRange = right.range();
  return (
    leftRange.start.index === rightRange.start.index && leftRange.end.index === rightRange.end.index
  );
}

function isConstVariableDeclarator(node: SgNode): boolean {
  return (
    node
      .parent()
      ?.children()
      .some((child) => child.kind() === "const") ?? false
  );
}

function sourceConstInitializerContent(node: SgNode): string | null {
  const directValue = literalModuleSource(node);
  if (directValue != null) return directValue;
  if (
    node.kind() !== "as_expression" &&
    node.kind() !== "satisfies_expression" &&
    node.kind() !== "parenthesized_expression"
  ) {
    return null;
  }
  for (const child of node.children()) {
    const childValue = sourceConstInitializerContent(child);
    if (childValue != null) return childValue;
  }
  return null;
}

function sourceConstVariableDeclaratorContent(node: SgNode, name: string): string | null {
  if (!isConstVariableDeclarator(node)) return null;
  const names = new Set<string>();
  collectBindingNames(node, names);
  if (!names.has(name)) return null;

  const initializer = node
    .children()
    .findLast((child) => sourceConstInitializerContent(child) != null);
  return initializer == null ? null : sourceConstInitializerContent(initializer);
}

function bindingNames(node: SgNode): Set<string> {
  const names = new Set<string>();
  collectBindingNames(node, names);
  return names;
}

function sourceStringVariableInScope(
  scope: SgNode,
  name: string,
  before: number,
): string | null | undefined {
  const bindings = scope
    .findAll({
      rule: {
        any: [
          { kind: "variable_declarator" },
          { kind: "required_parameter" },
          { kind: "optional_parameter" },
          { kind: "catch_clause" },
        ],
      },
    })
    .filter(
      (node) => node.range().start.index < before && sameRange(nearestSourceScope(node), scope),
    )
    .toSorted((a, b) => b.range().start.index - a.range().start.index);

  for (const binding of bindings) {
    if (!bindingNames(binding).has(name)) continue;
    return binding.kind() === "variable_declarator"
      ? sourceConstVariableDeclaratorContent(binding, name)
      : null;
  }

  return undefined;
}

function sourceScopedStringVariableContent(identifier: SgNode): string | null {
  const name = identifier.text();
  const before = identifier.range().start.index;
  let current = identifier.parent();
  while (current) {
    if (isSourceScopeNode(current)) {
      const value = sourceStringVariableInScope(current, name, before);
      if (value !== undefined) return value;
    }
    current = current.parent();
  }
  return null;
}

function isDynamicImportCall(node: SgNode): boolean {
  return (
    node.kind() === "call_expression" && node.children().some((child) => child.kind() === "import")
  );
}

function isArgumentSyntaxNode(node: SgNode): boolean {
  const kind = node.kind();
  return kind === "(" || kind === ")" || kind === "," || kind === "comment";
}

function firstCallArgument(callExpression: SgNode): SgNode | null {
  const args = callExpression.children().find((child) => child.kind() === "arguments");
  return args?.children().find((child) => !isArgumentSyntaxNode(child)) ?? null;
}

function dynamicImportSourceName(callExpression: SgNode): string | null {
  const sourceArg = firstCallArgument(callExpression);
  if (!sourceArg) return null;

  const sourceName = literalModuleSource(sourceArg);
  if (sourceName != null) return sourceName;

  return sourceArg.kind() === "identifier" ? sourceScopedStringVariableContent(sourceArg) : null;
}

function dynamicImportExcerptNode(callExpression: SgNode): SgNode {
  let current = callExpression;
  while (current.parent()) {
    const parent = current.parent();
    if (!parent) break;
    if (
      parent.kind() !== "await_expression" &&
      parent.kind() !== "parenthesized_expression" &&
      parent.kind() !== "member_expression"
    ) {
      break;
    }
    current = parent;
  }
  return current;
}

function dynamicRuntimeImportFindings(root: SgNode, relativePath: string): LlmReviewFinding[] {
  const findings: LlmReviewFinding[] = [];
  for (const callExpression of root.findAll({ rule: { kind: "call_expression" } })) {
    if (!isDynamicImportCall(callExpression)) continue;
    const sourceName = dynamicImportSourceName(callExpression);
    if (!sourceName || !MODULES_BY_SOURCE.has(sourceName)) continue;
    const excerptNode = dynamicImportExcerptNode(callExpression);
    findings.push({
      file: relativePath,
      line: excerptNode.range().start.line + 1,
      message: "Dynamic runtime subpath import may still access a removed flat value export.",
      excerpt: excerptNode.text().trim(),
    });
  }
  return findings;
}

export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  if (!quickFilter(source)) return [];

  const root = parse(sourceLang(filePath, source), source).root();
  const findings: LlmReviewFinding[] = [];
  findings.push(...dynamicRuntimeImportFindings(root, relativePath));

  for (const importStmt of findImportStatements(root)) {
    const sourceName = importSource(importStmt);
    if (!sourceName) continue;
    const mod = MODULES_BY_SOURCE.get(sourceName);
    if (!mod) continue;

    const hasNamespaceImport = namespaceImportName(importStmt) != null;
    const hasRemovedFlatImport = hasRemovedFlatSpecifier(importStmt, mod);
    if (!hasNamespaceImport && !hasRemovedFlatImport) continue;

    findings.push({
      file: relativePath,
      line: importStmt.range().start.line + 1,
      message: "Runtime subpath import still uses a removed namespace-star or flat value import.",
      excerpt: importStmt.text().trim(),
    });
  }

  for (const exportStmt of findExportStatements(root)) {
    const sourceName = importSource(exportStmt);
    if (!sourceName) continue;
    const mod = MODULES_BY_SOURCE.get(sourceName);
    if (!mod || (!hasRemovedFlatSpecifier(exportStmt, mod) && !isExportStar(exportStmt))) continue;

    findings.push({
      file: relativePath,
      line: exportStmt.range().start.line + 1,
      message: "Runtime subpath re-export still uses a removed flat value export.",
      excerpt: exportStmt.text().trim(),
    });
  }

  return findings;
}
