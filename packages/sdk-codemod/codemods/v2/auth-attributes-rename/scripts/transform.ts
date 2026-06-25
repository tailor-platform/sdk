import { parse, Lang } from "@ast-grep/napi";
import type { Edit, SgNode } from "@ast-grep/napi";

const SDK_MODULE = "@tailor-platform/sdk";

const TYPE_RENAME_MAP: Record<string, string> = {
  AttributeMap: "Attributes",
  UserAttributeMap: "UserAttributes",
  InferredAttributeMap: "InferredAttributes",
};

function quickFilter(source: string): boolean {
  return (
    source.includes(SDK_MODULE) &&
    Object.keys(TYPE_RENAME_MAP).some((name) => source.includes(name))
  );
}

function isSdkModuleLiteral(node: SgNode): boolean {
  return node.kind() === "string" && /^["']@tailor-platform\/sdk["']$/.test(node.text());
}

function hasSdkModuleLiteral(node: SgNode): boolean {
  return node.findAll({ rule: { kind: "string" } }).some(isSdkModuleLiteral);
}

function moduleSpecifierLiteral(node: SgNode): SgNode | undefined {
  const directLiteral = node.children().find((child: SgNode) => child.kind() === "string");
  if (directLiteral) return directLiteral;
  const moduleNode = node.children().find((child: SgNode) => child.kind() === "module");
  return moduleNode?.children().find((child: SgNode) => child.kind() === "string");
}

function hasSdkModuleSpecifier(node: SgNode): boolean {
  const literal = moduleSpecifierLiteral(node);
  return literal ? isSdkModuleLiteral(literal) : false;
}

function identifierChildren(node: SgNode): SgNode[] {
  return node.children().filter((child: SgNode) => child.kind() === "identifier");
}

function typeIdentifierChildren(node: SgNode): SgNode[] {
  return node.children().filter((child: SgNode) => child.kind() === "type_identifier");
}

function sameRange(a: SgNode, b: SgNode): boolean {
  const ar = a.range();
  const br = b.range();
  return ar.start.index === br.start.index && ar.end.index === br.end.index;
}

function addReplacement(
  edits: Edit[],
  editedRanges: Set<string>,
  node: SgNode,
  replacement: string,
): void {
  if (node.text() === replacement) return;
  const r = node.range();
  const key = `${r.start.index}:${r.end.index}`;
  if (editedRanges.has(key)) return;
  editedRanges.add(key);
  edits.push(node.replace(replacement));
}

function renamedType(name: string): string | undefined {
  return TYPE_RENAME_MAP[name];
}

function isDeclarationName(node: SgNode): boolean {
  const parent = node.parent();
  if (
    !parent ||
    ![
      "class_declaration",
      "enum_declaration",
      "interface_declaration",
      "type_alias_declaration",
      "type_parameter",
    ].includes(parent.kind())
  ) {
    return false;
  }
  const name = parent?.field("name");
  return !!name && sameRange(name, node);
}

function isNestedTypeName(node: SgNode): boolean {
  return node.parent()?.kind() === "nested_type_identifier";
}

function declarationName(node: SgNode): SgNode | undefined {
  if (
    [
      "class_declaration",
      "enum_declaration",
      "interface_declaration",
      "type_alias_declaration",
    ].includes(node.kind())
  ) {
    return node.field("name") ?? undefined;
  }
  if (node.kind() !== "export_statement") return undefined;
  const declaration = node
    .children()
    .find((child: SgNode) =>
      [
        "class_declaration",
        "enum_declaration",
        "interface_declaration",
        "type_alias_declaration",
      ].includes(child.kind()),
    );
  return declaration?.field("name") ?? undefined;
}

function scopeDeclaresType(scope: SgNode, name: string, reference: SgNode): boolean {
  return scope.children().some((child: SgNode) => {
    const declaredName = declarationName(child);
    return !!declaredName && declaredName.text() === name && !sameRange(declaredName, reference);
  });
}

function hasTypeParameterShadow(node: SgNode, name: string): boolean {
  const parameters = node.findAll({ rule: { kind: "type_parameter" } });
  return parameters.some((parameter) => typeIdentifierChildren(parameter)[0]?.text() === name);
}

function isShadowedTypeReference(node: SgNode, name: string): boolean {
  let current = node.parent();
  while (current) {
    if (current.kind() === "statement_block" && scopeDeclaresType(current, name, node)) {
      return true;
    }
    if (
      [
        "class_declaration",
        "function_declaration",
        "interface_declaration",
        "method_definition",
        "type_alias_declaration",
      ].includes(current.kind()) &&
      hasTypeParameterShadow(current, name)
    ) {
      return true;
    }
    current = current.parent();
  }
  return false;
}

function collectSdkImports(
  root: SgNode,
  edits: Edit[],
  editedRanges: Set<string>,
): {
  localTypeRenames: Map<string, string>;
  namespaceNames: Set<string>;
} {
  const localTypeRenames = new Map<string, string>();
  const namespaceNames = new Set<string>();
  const importStmts = root.findAll({ rule: { kind: "import_statement" } });

  for (const importStmt of importStmts) {
    if (!hasSdkModuleSpecifier(importStmt)) continue;

    const namespaceImports = importStmt.findAll({ rule: { kind: "namespace_import" } });
    for (const namespaceImport of namespaceImports) {
      const localName = identifierChildren(namespaceImport).at(-1)?.text();
      if (localName) namespaceNames.add(localName);
    }

    const specs = importStmt.findAll({ rule: { kind: "import_specifier" } });
    for (const spec of specs) {
      const identifiers = identifierChildren(spec);
      const imported = identifiers[0];
      if (!imported) continue;
      const replacement = renamedType(imported.text());
      if (!replacement) continue;

      addReplacement(edits, editedRanges, imported, replacement);
      if (identifiers.length === 1) {
        localTypeRenames.set(imported.text(), replacement);
      }
    }
  }

  return { localTypeRenames, namespaceNames };
}

function rewriteSdkExports(root: SgNode, edits: Edit[], editedRanges: Set<string>): void {
  const exportStmts = root.findAll({ rule: { kind: "export_statement" } });
  for (const exportStmt of exportStmts) {
    if (!hasSdkModuleSpecifier(exportStmt)) continue;

    const specs = exportStmt.findAll({ rule: { kind: "export_specifier" } });
    for (const spec of specs) {
      const exported = identifierChildren(spec)[0];
      if (!exported) continue;
      const replacement = renamedType(exported.text());
      if (replacement) addReplacement(edits, editedRanges, exported, replacement);
    }
  }
}

function rewriteModuleAugmentations(root: SgNode, edits: Edit[], editedRanges: Set<string>): void {
  const declarations = root.findAll({ rule: { kind: "ambient_declaration" } });
  for (const declaration of declarations) {
    if (!hasSdkModuleSpecifier(declaration)) continue;

    const interfaces = declaration.findAll({ rule: { kind: "interface_declaration" } });
    for (const iface of interfaces) {
      const name = typeIdentifierChildren(iface)[0];
      if (name?.text() === "AttributeMap") {
        addReplacement(edits, editedRanges, name, "Attributes");
      }
    }
  }
}

function rewriteLocalTypeReferences(
  root: SgNode,
  edits: Edit[],
  editedRanges: Set<string>,
  localTypeRenames: Map<string, string>,
): void {
  if (localTypeRenames.size === 0) return;

  const typeIdentifiers = root.findAll({ rule: { kind: "type_identifier" } });
  for (const typeIdentifier of typeIdentifiers) {
    if (isDeclarationName(typeIdentifier) || isNestedTypeName(typeIdentifier)) continue;
    const replacement = localTypeRenames.get(typeIdentifier.text());
    if (replacement && isShadowedTypeReference(typeIdentifier, typeIdentifier.text())) continue;
    if (replacement) addReplacement(edits, editedRanges, typeIdentifier, replacement);
  }
}

function rewriteNamespaceTypeReferences(
  root: SgNode,
  edits: Edit[],
  editedRanges: Set<string>,
  namespaceNames: Set<string>,
): void {
  if (namespaceNames.size === 0) return;

  const nestedTypes = root.findAll({ rule: { kind: "nested_type_identifier" } });
  for (const nestedType of nestedTypes) {
    const namespaceName = identifierChildren(nestedType)[0]?.text();
    if (!namespaceName || !namespaceNames.has(namespaceName)) continue;
    const typeName = typeIdentifierChildren(nestedType).at(-1);
    if (!typeName) continue;
    const replacement = renamedType(typeName.text());
    if (replacement) addReplacement(edits, editedRanges, typeName, replacement);
  }
}

function isSdkImportCall(node: SgNode): boolean {
  return node.kind() === "call_expression" && hasSdkModuleLiteral(node);
}

function rewriteImportTypeReferences(root: SgNode, edits: Edit[], editedRanges: Set<string>): void {
  const members = root.findAll({ rule: { kind: "member_expression" } });
  for (const member of members) {
    const object = member.field("object");
    if (!object || !isSdkImportCall(object)) continue;
    const property = member.field("property");
    if (!property || property.kind() !== "property_identifier") continue;
    const replacement = renamedType(property.text());
    if (replacement) addReplacement(edits, editedRanges, property, replacement);
  }
}

/**
 * Rename the v1 auth attribute type API to its v2 names only when a reference
 * can be tied to `@tailor-platform/sdk`.
 * @param source - File contents
 * @param _filePath - Absolute path to the file (kept for the runner signature)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, _filePath?: string): string | null {
  if (!quickFilter(source)) return null;

  const filePath = _filePath?.toLowerCase();
  const lang =
    filePath?.endsWith(".tsx") || filePath?.endsWith(".jsx")
      ? Lang.Tsx
      : filePath
        ? Lang.TypeScript
        : source.includes("</") || source.includes("/>")
          ? Lang.Tsx
          : Lang.TypeScript;
  const root = parse(lang, source).root();

  const edits: Edit[] = [];
  const editedRanges = new Set<string>();

  const { localTypeRenames, namespaceNames } = collectSdkImports(root, edits, editedRanges);
  rewriteSdkExports(root, edits, editedRanges);
  rewriteModuleAugmentations(root, edits, editedRanges);
  rewriteLocalTypeReferences(root, edits, editedRanges, localTypeRenames);
  rewriteNamespaceTypeReferences(root, edits, editedRanges, namespaceNames);
  rewriteImportTypeReferences(root, edits, editedRanges);

  if (edits.length === 0) return null;
  return root.commitEdits(edits);
}
