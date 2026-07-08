import { parse, Lang } from "@ast-grep/napi";
import {
  findImportStatements,
  importBindings,
  importSource,
} from "../../../../src/ast-grep-helpers";
import type { Edit, SgNode } from "@ast-grep/napi";

const SDK_MODULE = "@tailor-platform/sdk";

function sourceLang(filePath: string, source: string): Lang {
  return filePath.endsWith(".tsx") || filePath.endsWith(".jsx") || source.includes("</")
    ? Lang.Tsx
    : Lang.TypeScript;
}

function namespaceImportNames(importStmt: SgNode): string[] {
  return importStmt
    .findAll({ rule: { kind: "namespace_import" } })
    .flatMap((node) => node.children().filter((child) => child.kind() === "identifier"))
    .map((node) => node.text());
}

function isInsideImportStatement(node: SgNode): boolean {
  let current = node.parent();
  while (current) {
    if (current.kind() === "import_statement") return true;
    current = current.parent();
  }
  return false;
}

function addShadowedRange(
  shadowedRanges: Map<string, Array<{ start: number; end: number }>>,
  name: string,
  scopeNode: SgNode,
) {
  const range = scopeNode.range();
  if (!shadowedRanges.has(name)) shadowedRanges.set(name, []);
  shadowedRanges.get(name)!.push({ start: range.start.index, end: range.end.index });
}

function nearestScope(node: SgNode): SgNode {
  let current: SgNode | null = node.parent();
  while (current) {
    const kind = current.kind();
    if (kind === "statement_block" || kind === "program" || kind === "for_statement") {
      return current;
    }
    current = current.parent();
  }
  return node;
}

function parameterScope(node: SgNode): SgNode {
  let current: SgNode | null = node.parent();
  while (current) {
    const kind = current.kind();
    if (kind === "formal_parameters") {
      current = current.parent();
      continue;
    }
    if (
      kind === "function_declaration" ||
      kind === "function_expression" ||
      kind === "arrow_function" ||
      kind === "method_definition"
    ) {
      return current;
    }
    break;
  }
  return nearestScope(node);
}

function buildShadowedRanges(root: SgNode, names: Set<string>) {
  const shadowedRanges = new Map<string, Array<{ start: number; end: number }>>();

  for (const decl of root.findAll({
    rule: { any: [{ kind: "function_declaration" }, { kind: "variable_declarator" }] },
  })) {
    if (isInsideImportStatement(decl)) continue;
    const name = decl
      .children()
      .find((child) => child.kind() === "identifier" && names.has(child.text()));
    if (name) addShadowedRange(shadowedRanges, name.text(), nearestScope(decl));
  }

  for (const param of root.findAll({
    rule: { any: [{ kind: "required_parameter" }, { kind: "optional_parameter" }] },
  })) {
    const name = param
      .children()
      .find((child) => child.kind() === "identifier" && names.has(child.text()));
    if (name) addShadowedRange(shadowedRanges, name.text(), parameterScope(param));
  }

  return shadowedRanges;
}

function isShadowed(
  node: SgNode,
  shadowedRanges: Map<string, Array<{ start: number; end: number }>>,
): boolean {
  const ranges = shadowedRanges.get(node.text());
  if (!ranges) return false;
  const position = node.range().start.index;
  return ranges.some((range) => position >= range.start && position < range.end);
}

function isSdkDbMember(
  object: SgNode | null,
  dbNames: Set<string>,
  namespaceNames: Set<string>,
  shadowedRanges: Map<string, Array<{ start: number; end: number }>>,
) {
  if (!object) return false;
  if (object.kind() === "identifier")
    return dbNames.has(object.text()) && !isShadowed(object, shadowedRanges);
  if (object.kind() !== "member_expression") return false;

  const base = object.field("object");
  const property = object.field("property");
  return (
    base?.kind() === "identifier" &&
    namespaceNames.has(base.text()) &&
    !isShadowed(base, shadowedRanges) &&
    property?.text() === "db"
  );
}

export default function transform(source: string, filePath: string): string | null {
  if (!source.includes(".type") || !source.includes(SDK_MODULE)) return null;

  let root: SgNode;
  try {
    root = parse(sourceLang(filePath, source), source).root();
  } catch {
    return null;
  }

  const imports = findImportStatements(root).filter(
    (importStmt) => importSource(importStmt) === SDK_MODULE,
  );
  if (imports.length === 0) return null;

  const dbNames = new Set<string>();
  const namespaceNames = new Set<string>();
  for (const importStmt of imports) {
    for (const binding of importBindings(importStmt)) {
      if (binding.importedName === "db" && !binding.typeOnly) dbNames.add(binding.localName);
    }
    for (const name of namespaceImportNames(importStmt)) {
      namespaceNames.add(name);
    }
  }
  if (dbNames.size === 0 && namespaceNames.size === 0) return null;

  const shadowedRanges = buildShadowedRanges(root, new Set([...dbNames, ...namespaceNames]));
  const edits: Edit[] = [];
  for (const member of root.findAll({ rule: { kind: "member_expression" } })) {
    const property = member.field("property");
    if (property?.text() !== "type") continue;
    if (!isSdkDbMember(member.field("object"), dbNames, namespaceNames, shadowedRanges)) continue;
    edits.push(property.replace("table"));
  }

  return edits.length > 0 ? root.commitEdits(edits) : null;
}
