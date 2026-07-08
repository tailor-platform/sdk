import { parse, Lang } from "@ast-grep/napi";
import {
  findImportStatements,
  importBindings,
  importSource,
} from "../../../../src/ast-grep-helpers";
import type { LlmReviewFinding } from "../../../../src/types";
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

function isBindingLeafKind(kind: ReturnType<SgNode["kind"]>): boolean {
  return kind === "identifier" || kind === "shorthand_property_identifier_pattern";
}

function isBindingPatternKind(kind: ReturnType<SgNode["kind"]>): boolean {
  return (
    isBindingLeafKind(kind) ||
    kind === "object_pattern" ||
    kind === "array_pattern" ||
    kind === "rest_pattern"
  );
}

function collectBindingNodes(node: SgNode, names: Set<string>, result: SgNode[]): void {
  if (isBindingLeafKind(node.kind())) {
    if (names.has(node.text())) result.push(node);
    return;
  }

  for (const child of node.children()) {
    if (child.kind() === "property_identifier") continue;
    if (child.kind() === "=") break;
    collectBindingNodes(child, names, result);
  }
}

function bindingNodes(node: SgNode, names: Set<string>): SgNode[] {
  const result: SgNode[] = [];
  collectBindingNodes(node, names, result);
  return result;
}

function directBindingNodes(node: SgNode, names: Set<string>): SgNode[] {
  const result: SgNode[] = [];
  for (const child of node.children()) {
    if (child.kind() === "=") break;
    if (isBindingPatternKind(child.kind())) collectBindingNodes(child, names, result);
  }
  return result;
}

function firstDeclaratorChild(node: SgNode): SgNode | null {
  return node.children().find((child) => child.kind() !== "=") ?? null;
}

function declaratorValue(node: SgNode): SgNode | null {
  const children = node.children();
  const equalsIndex = children.findIndex((child) => child.kind() === "=");
  if (equalsIndex === -1) return null;
  return children.slice(equalsIndex + 1).find((child) => child.kind() !== "comment") ?? null;
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
    if (
      kind === "statement_block" ||
      kind === "program" ||
      kind === "switch_body" ||
      kind === "for_statement" ||
      kind === "for_in_statement"
    ) {
      return current;
    }
    current = current.parent();
  }
  return node;
}

function functionScope(node: SgNode): SgNode {
  let current: SgNode | null = node.parent();
  while (current) {
    const kind = current.kind();
    if (
      kind === "function_declaration" ||
      kind === "function_expression" ||
      kind === "arrow_function" ||
      kind === "method_definition" ||
      kind === "program"
    ) {
      return current;
    }
    current = current.parent();
  }
  return node;
}

function variableDeclarationScope(node: SgNode): SgNode {
  const declaration = node.parent();
  if (/^var\b/.test(declaration?.text().trimStart() ?? "")) return functionScope(node);
  return nearestScope(node);
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

  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    if (isInsideImportStatement(decl)) continue;
    const binding = firstDeclaratorChild(decl);
    if (!binding) continue;
    for (const name of bindingNodes(binding, names)) {
      addShadowedRange(shadowedRanges, name.text(), variableDeclarationScope(decl));
    }
  }

  for (const decl of root.findAll({
    rule: {
      any: [
        { kind: "function_declaration" },
        { kind: "class_declaration" },
        { kind: "enum_declaration" },
      ],
    },
  })) {
    const name = decl
      .children()
      .find((child) => child.kind() === "identifier" && names.has(child.text()));
    if (name) addShadowedRange(shadowedRanges, name.text(), nearestScope(decl));
  }

  for (const param of root.findAll({
    rule: { any: [{ kind: "required_parameter" }, { kind: "optional_parameter" }] },
  })) {
    for (const name of directBindingNodes(param, names)) {
      addShadowedRange(shadowedRanges, name.text(), parameterScope(param));
    }
  }

  for (const arrow of root.findAll({ rule: { kind: "arrow_function" } })) {
    const children = arrow.children();
    const arrowIndex = children.findIndex((child) => child.kind() === "=>");
    if (arrowIndex === -1) continue;
    for (const child of children.slice(0, arrowIndex)) {
      if (child.kind() === "=") break;
      if (!isBindingPatternKind(child.kind())) continue;
      for (const name of bindingNodes(child, names)) {
        addShadowedRange(shadowedRanges, name.text(), arrow);
      }
    }
  }

  for (const catchClause of root.findAll({ rule: { kind: "catch_clause" } })) {
    for (const name of directBindingNodes(catchClause, names)) {
      addShadowedRange(shadowedRanges, name.text(), catchClause);
    }
  }

  for (const loop of root.findAll({ rule: { kind: "for_in_statement" } })) {
    const children = loop.children();
    const keywordIndex = children.findIndex(
      (child) => child.kind() === "in" || child.kind() === "of",
    );
    if (keywordIndex === -1) continue;
    for (const child of children.slice(0, keywordIndex)) {
      for (const name of bindingNodes(child, names)) {
        addShadowedRange(shadowedRanges, name.text(), loop);
      }
    }
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

function unwrapExpression(node: SgNode | null): SgNode | null {
  let current = node;
  while (current) {
    const kind = current.kind();
    if (kind === "parenthesized_expression") {
      current =
        current.children().find((child) => child.kind() !== "(" && child.kind() !== ")") ?? null;
      continue;
    }
    if (
      kind === "as_expression" ||
      kind === "satisfies_expression" ||
      kind === "non_null_expression"
    ) {
      current = current.children()[0] ?? null;
      continue;
    }
    if (kind === "type_assertion") {
      current = current.children().find((child) => child.kind() !== "type_arguments") ?? null;
      continue;
    }
    return current;
  }
  return null;
}

function isSdkDbMember(
  object: SgNode | null,
  dbNames: Set<string>,
  namespaceNames: Set<string>,
  shadowedRanges: Map<string, Array<{ start: number; end: number }>>,
) {
  const unwrapped = unwrapExpression(object);
  if (!unwrapped) return false;
  if (unwrapped.kind() === "identifier")
    return dbNames.has(unwrapped.text()) && !isShadowed(unwrapped, shadowedRanges);
  if (unwrapped.kind() !== "member_expression") return false;

  const base = unwrapExpression(unwrapped.field("object"));
  const property = unwrapped.field("property");
  return (
    base?.kind() === "identifier" &&
    namespaceNames.has(base.text()) &&
    !isShadowed(base, shadowedRanges) &&
    property?.text() === "db"
  );
}

function typeStringLiteral(node: SgNode | null): SgNode | null {
  if (!node) return null;
  const kind = node.kind();
  if (kind !== "string" && kind !== "template_string") return null;
  const fragments = node.children().filter((child) => child.kind() === "string_fragment");
  return fragments.length === 1 && fragments[0]!.text() === "type" ? node : null;
}

function replaceStringLiteralValue(node: SgNode, value: string): Edit {
  const text = node.text();
  const quote = text.startsWith("'") ? "'" : text.startsWith("`") ? "`" : '"';
  return node.replace(`${quote}${value}${quote}`);
}

function hasTypeBuilderUse(root: SgNode, name: string, afterIndex: number): boolean {
  for (const member of root.findAll({ rule: { kind: "member_expression" } })) {
    if (member.range().start.index <= afterIndex) continue;
    if (member.field("property")?.text() !== "type") continue;
    const object = unwrapExpression(member.field("object"));
    if (object?.kind() === "identifier" && object.text() === name) return true;
  }

  for (const subscript of root.findAll({ rule: { kind: "subscript_expression" } })) {
    if (subscript.range().start.index <= afterIndex) continue;
    if (!typeStringLiteral(subscript.field("index"))) continue;
    const object = unwrapExpression(subscript.field("object"));
    if (object?.kind() === "identifier" && object.text() === name) return true;
  }

  return false;
}

export default function transform(source: string, filePath: string): string | null {
  if (!source.includes("type") || !source.includes(SDK_MODULE)) return null;

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
  for (const subscript of root.findAll({ rule: { kind: "subscript_expression" } })) {
    const index = typeStringLiteral(subscript.field("index"));
    if (!index) continue;
    if (!isSdkDbMember(subscript.field("object"), dbNames, namespaceNames, shadowedRanges)) {
      continue;
    }
    edits.push(replaceStringLiteralValue(index, "table"));
  }

  return edits.length > 0 ? root.commitEdits(edits) : null;
}

function lineForIndex(source: string, index: number): number {
  return source.slice(0, index).split(/\r\n|\r|\n/).length;
}

function excerptAtIndex(source: string, index: number): string {
  const lineStart = Math.max(source.lastIndexOf("\n", index - 1) + 1, 0);
  const lineEnd = source.indexOf("\n", index);
  return source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim();
}

function objectPatternHasTypeProperty(pattern: SgNode): boolean {
  return pattern
    .findAll({
      rule: {
        any: [
          { kind: "property_identifier", regex: "^type$" },
          { kind: "shorthand_property_identifier_pattern", regex: "^type$" },
        ],
      },
    })
    .some((node) => node.text() === "type");
}

export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  if (!source.includes("type") || !source.includes(SDK_MODULE)) return [];

  let root: SgNode;
  try {
    root = parse(sourceLang(filePath, source), source).root();
  } catch {
    return [];
  }

  const imports = findImportStatements(root).filter(
    (importStmt) => importSource(importStmt) === SDK_MODULE,
  );
  if (imports.length === 0) return [];

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
  if (dbNames.size === 0 && namespaceNames.size === 0) return [];

  const shadowedRanges = buildShadowedRanges(root, new Set([...dbNames, ...namespaceNames]));
  const findings: LlmReviewFinding[] = [];

  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const binding = firstDeclaratorChild(decl);
    if (binding?.kind() !== "object_pattern" || !objectPatternHasTypeProperty(binding)) continue;
    const value = declaratorValue(decl);
    if (!isSdkDbMember(value, dbNames, namespaceNames, shadowedRanges)) continue;

    findings.push({
      file: relativePath,
      line: lineForIndex(source, binding.range().start.index),
      message: "Review destructured db.type builder usage and migrate it to db.table.",
      excerpt: excerptAtIndex(source, binding.range().start.index),
    });
  }

  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const binding = firstDeclaratorChild(decl);
    if (binding?.kind() !== "identifier") continue;
    const value = declaratorValue(decl);
    if (!isSdkDbMember(value, dbNames, namespaceNames, shadowedRanges)) continue;
    if (!hasTypeBuilderUse(root, binding.text(), decl.range().end.index)) continue;

    findings.push({
      file: relativePath,
      line: lineForIndex(source, binding.range().start.index),
      message: "Review SDK db alias usage and migrate db.type builder calls to db.table.",
      excerpt: excerptAtIndex(source, binding.range().start.index),
    });
  }

  return findings;
}
