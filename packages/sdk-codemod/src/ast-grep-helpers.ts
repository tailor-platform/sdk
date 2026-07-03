import type { Edit, SgNode } from "@ast-grep/napi";

const DECLARATION_KINDS = [
  "function_declaration",
  "function_expression",
  "class_declaration",
  "class",
  "enum_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "internal_module",
  "import_alias",
];

export interface ImportSpecifierNames {
  importedName: string;
  localName: string;
  typeOnly: boolean;
}

export interface ImportBinding {
  localName: string;
  importedName?: string;
  source: string;
  typeOnly: boolean;
}

export interface AddNamedImportEditOptions {
  importName: string;
  imports: SgNode[];
  insertionIndex: (root: SgNode, imports: SgNode[], source: string) => number;
  moduleName: string;
  root: SgNode;
  source: string;
}

function isBindingLeafKind(kind: ReturnType<SgNode["kind"]>): boolean {
  return (
    kind === "identifier" ||
    kind === "type_identifier" ||
    kind === "shorthand_property_identifier_pattern"
  );
}

function isBindingPatternKind(kind: ReturnType<SgNode["kind"]>): boolean {
  return (
    isBindingLeafKind(kind) ||
    kind === "object_pattern" ||
    kind === "array_pattern" ||
    kind === "rest_pattern"
  );
}

export function stringValue(node: SgNode | null): string | null {
  return node?.text().replace(/^['"]|['"]$/g, "") ?? null;
}

export function importSource(importStmt: SgNode): string | null {
  return stringValue(importStmt.find({ rule: { kind: "string" } }) ?? null);
}

export function isTypeOnlyImport(importStmt: SgNode): boolean {
  return importStmt.children().some((child) => child.kind() === "type");
}

export function namedImportsNode(importStmt: SgNode): SgNode | null {
  return importStmt.find({ rule: { kind: "named_imports" } }) ?? null;
}

export function importSpecNames(spec: SgNode): ImportSpecifierNames | null {
  const ids = spec.children().filter((child) => child.kind() === "identifier");
  if (ids.length === 0) return null;
  return {
    importedName: ids[0]!.text(),
    localName: ids[1]?.text() ?? ids[0]!.text(),
    typeOnly: spec.children().some((child) => child.kind() === "type"),
  };
}

export function findImportStatements(root: SgNode): SgNode[] {
  return root
    .findAll({ rule: { kind: "import_statement" } })
    .filter((stmt) => stmt.parent()?.kind() === "program")
    .toSorted((a, b) => a.range().start.index - b.range().start.index);
}

export function importBindings(importStmt: SgNode): ImportBinding[] {
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
      const local = child.children().find((grandchild) => grandchild.kind() === "identifier");
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

export function buildAddNamedImportEdit(options: AddNamedImportEditOptions): Edit {
  const { importName, imports, insertionIndex, moduleName, root, source } = options;
  const existingImport =
    imports.find(
      (importStmt) =>
        importSource(importStmt) === moduleName &&
        !isTypeOnlyImport(importStmt) &&
        namedImportsNode(importStmt),
    ) ?? null;
  const namedImports = existingImport ? namedImportsNode(existingImport) : null;
  if (namedImports) {
    const specTexts = namedImports.findAll({ rule: { kind: "import_specifier" } }).map((spec) => {
      const names = importSpecNames(spec);
      return names?.importedName === importName && names.localName === importName
        ? importName
        : spec.text();
    });
    const nextSpecTexts = specTexts.includes(importName) ? specTexts : [...specTexts, importName];
    return namedImports.replace(`{ ${nextSpecTexts.join(", ")} }`);
  }

  const pos = insertionIndex(root, imports, source);
  const insertedText =
    pos === 0 || source[pos - 1] === "\n"
      ? `import { ${importName} } from "${moduleName}";\n\n`
      : `\nimport { ${importName} } from "${moduleName}";`;
  return { startPos: pos, endPos: pos, insertedText };
}

export function collectBindingNames(node: SgNode, names: Set<string>): void {
  if (isBindingLeafKind(node.kind())) {
    names.add(node.text());
    return;
  }

  for (const child of node.children()) {
    if (child.kind() === "property_identifier") continue;
    if (child.kind() === "=") break;
    collectBindingNames(child, names);
  }
}

function firstDeclaratorChild(node: SgNode): SgNode | null {
  return node.children().find((child) => child.kind() !== "=") ?? null;
}

function collectDirectBindingChildren(node: SgNode, names: Set<string>): void {
  for (const child of node.children()) {
    if (child.kind() === "=") break;
    if (isBindingPatternKind(child.kind())) collectBindingNames(child, names);
  }
}

function collectParameters(root: SgNode, names: Set<string>): void {
  for (const param of root.findAll({
    rule: { any: [{ kind: "required_parameter" }, { kind: "optional_parameter" }] },
  })) {
    collectDirectBindingChildren(param, names);
  }
}

function collectDeclarationNames(root: SgNode, names: Set<string>): void {
  for (const decl of root.findAll({ rule: { any: DECLARATION_KINDS.map((kind) => ({ kind })) } })) {
    const name = decl
      .children()
      .find((child) => child.kind() === "identifier" || child.kind() === "type_identifier");
    if (name) names.add(name.text());
  }
}

function collectArrowParameters(root: SgNode, names: Set<string>): void {
  for (const arrow of root.findAll({ rule: { kind: "arrow_function" } })) {
    const children = arrow.children();
    const arrowIndex = children.findIndex((child) => child.kind() === "=>");
    if (arrowIndex === -1) continue;
    for (const child of children.slice(0, arrowIndex)) {
      if (child.kind() === "=") break;
      if (isBindingPatternKind(child.kind())) collectBindingNames(child, names);
    }
  }
}

function collectForInBindings(root: SgNode, names: Set<string>): void {
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
}

export function localDeclarationNames(root: SgNode): Set<string> {
  const names = new Set<string>();

  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const binding = firstDeclaratorChild(decl);
    if (binding) collectBindingNames(binding, names);
  }

  collectParameters(root, names);
  collectDeclarationNames(root, names);

  for (const catchClause of root.findAll({ rule: { kind: "catch_clause" } })) {
    collectDirectBindingChildren(catchClause, names);
  }

  collectArrowParameters(root, names);
  collectForInBindings(root, names);

  return names;
}
