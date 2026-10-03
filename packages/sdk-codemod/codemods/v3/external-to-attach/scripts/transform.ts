import { Lang, parse } from "@ast-grep/napi";
import {
  findImportStatements,
  importBindings,
  localDeclarationNames,
  stringValue,
} from "../../../../src/ast-grep-helpers";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

type Finding = { node: SgNode; reason: string };
type Analysis = { root: SgNode; edits: Edit[]; findings: Finding[] };

function entries(node: SgNode): SgNode[] {
  return node
    .children()
    .filter((child) => !["{", "}", "[", "]", ",", "comment"].includes(String(child.kind())));
}

function entryKey(node: SgNode): string | null {
  if (node.kind() === "shorthand_property_identifier") return node.text();
  if (node.kind() !== "pair") return null;
  const key = node.field("key");
  return key?.kind() === "property_identifier" || key?.kind() === "string"
    ? stringValue(key)
    : null;
}

function objectEntries(node: SgNode, analysis: Analysis): SgNode[] | null {
  if (node.kind() !== "object") {
    analysis.findings.push({ node, reason: "the setting is not an object literal" });
    return null;
  }
  const properties = entries(node);
  if (properties.some((entry) => entryKey(entry) === null)) {
    analysis.findings.push({
      node,
      reason: "a spread or computed key may hide attachment settings",
    });
    return null;
  }
  return properties;
}

function migrateService(node: SgNode, named: boolean, analysis: Analysis): void {
  const properties = objectEntries(node, analysis);
  if (!properties) return;
  const legacy = properties.filter((entry) => entryKey(entry) === "external");
  if (legacy.length === 0) return;
  if (
    legacy.length !== 1 ||
    properties.some((entry) => !["external", ...(named ? ["name"] : [])].includes(entryKey(entry)!))
  ) {
    analysis.findings.push({ node, reason: "external is combined with other options or repeated" });
    return;
  }
  const property = legacy[0]!;
  if (property.field("value")?.kind() !== "true") {
    analysis.findings.push({ node: property, reason: "external is not the literal true" });
    return;
  }
  const key = property.field("key")!;
  analysis.edits.push(key.replace(key.text().replace("external", "attach")));
}

function analyzeConfig(node: SgNode, analysis: Analysis): void {
  const properties = objectEntries(node, analysis);
  if (!properties) return;
  for (const property of properties) {
    const key = entryKey(property);
    if (key !== "db" && key !== "resolver" && key !== "auth" && key !== "idp") continue;
    const value = property.field("value") ?? property;
    if (key === "auth") {
      migrateService(value, true, analysis);
    } else if (key === "idp") {
      if (value.kind() !== "array") {
        analysis.findings.push({ node: value, reason: "idp is not an array literal" });
        continue;
      }
      for (const idp of entries(value)) migrateService(idp, true, analysis);
    } else {
      const namespaces = objectEntries(value, analysis);
      if (!namespaces) continue;
      for (const namespace of namespaces) {
        migrateService(namespace.field("value") ?? namespace, false, analysis);
      }
    }
  }
}

function analyze(source: string, filePath: string): Analysis {
  const root = parse(/\.[jt]sx$/u.test(filePath) ? Lang.Tsx : Lang.TypeScript, source).root();
  const analysis: Analysis = { root, edits: [], findings: [] };
  const functions = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of findImportStatements(root)) {
    const namespace = statement.find({ rule: { kind: "namespace_import" } });
    const namespaceName = namespace
      ?.children()
      .find((child) => child.kind() === "identifier")
      ?.text();
    for (const binding of importBindings(statement)) {
      if (binding.source !== "@tailor-platform/sdk" || binding.typeOnly) continue;
      if (binding.importedName === "defineConfig") functions.add(binding.localName);
      if (binding.localName === namespaceName) namespaces.add(binding.localName);
    }
  }
  const declared = localDeclarationNames(root);
  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    const callee = call.field("function");
    let name: string | undefined;
    if (callee?.kind() === "identifier" && functions.has(callee.text())) {
      name = callee.text();
    } else if (
      callee?.kind() === "member_expression" &&
      callee.field("property")?.text() === "defineConfig"
    ) {
      const object = callee.field("object");
      if (object?.kind() === "identifier" && namespaces.has(object.text())) name = object.text();
    }
    if (!name) continue;
    if (declared.has(name)) {
      analysis.findings.push({ node: call, reason: `\`${name}\` is declared again in this file` });
      continue;
    }
    const args =
      call
        .field("arguments")
        ?.children()
        .filter((child) => !["(", ")", ",", "comment"].includes(String(child.kind()))) ?? [];
    if (args.length === 1) analyzeConfig(args[0]!, analysis);
  }
  return analysis;
}

/**
 * Rename external service references in SDK application configs.
 * @param source - File contents
 * @param filePath - Path to the file being transformed
 * @returns Updated source, or null when no settings can be migrated
 */
export default function transform(source: string, filePath = ""): string | null {
  const { root, edits } = analyze(source, filePath);
  return edits.length > 0 ? root.commitEdits(edits) : null;
}

/**
 * Report attachment settings that require manual migration.
 * @param source - File contents
 * @param filePath - Path to the file being reviewed
 * @param relativePath - Repository-relative path reported to the user
 * @returns Findings for settings that could not be migrated
 */
export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  return analyze(source, filePath).findings.map(({ node, reason }) => ({
    file: relativePath,
    line: node.range().start.line + 1,
    message: `Review external service references and replace external: true with attach: true: ${reason}.`,
    excerpt: node.text().split("\n", 1)[0]!.trim(),
  }));
}
