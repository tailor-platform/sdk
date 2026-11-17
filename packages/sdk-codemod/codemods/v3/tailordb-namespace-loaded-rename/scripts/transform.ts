import {
  excerptOf,
  findImportStatements,
  importBindings,
  importSource,
  importSpecNames,
  lineOf,
  localDeclarationNames,
  parseRoot,
  stringValue,
} from "../../../../src/ast-grep-helpers";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const SDK_MODULE = "@tailor-platform/sdk";
const LEGACY_HOOK = "onNamespaceLoaded";
const HOOK = "onTailorDBNamespaceLoaded";
const TYPE_RENAMES: ReadonlyMap<string, string> = new Map([
  ["PluginNamespaceProcessContext", "TailorDBNamespaceLoadedContext"],
  ["NamespacePluginOutput", "TailorDBNamespacePluginOutput"],
]);

const MEMBER_CONTAINER_KINDS: ReadonlySet<string> = new Set([
  "object",
  "object_pattern",
  "class_body",
  "interface_body",
  "object_type",
]);
const KEYED_ENTRY_KINDS: ReadonlySet<string> = new Set(["pair", "pair_pattern"]);
const NAMED_ENTRY_KINDS: ReadonlySet<string> = new Set([
  "method_definition",
  "method_signature",
  "property_signature",
  "public_field_definition",
]);
const SHORTHAND_KINDS: ReadonlySet<string> = new Set([
  "shorthand_property_identifier",
  "shorthand_property_identifier_pattern",
]);
const STRING_NAME_PARENT_KINDS: ReadonlySet<string> = new Set([
  ...KEYED_ENTRY_KINDS,
  ...NAMED_ENTRY_KINDS,
  "literal_type",
  "subscript_expression",
]);

function quickFilter(source: string): boolean {
  return source.includes(LEGACY_HOOK) || [...TYPE_RENAMES.keys()].some((n) => source.includes(n));
}

function isSdkModule(source: string | null): boolean {
  return source === SDK_MODULE || (source?.startsWith(`${SDK_MODULE}/`) ?? false);
}

function exportSource(exportStmt: SgNode): string | null {
  return stringValue(exportStmt.field("source"));
}

function sdkReExports(root: SgNode): SgNode[] {
  return root
    .findAll({ rule: { kind: "export_statement" } })
    .filter((stmt) => exportSource(stmt) === SDK_MODULE);
}

function nameText(node: SgNode | null): string | null {
  if (node?.kind() === "property_identifier") return node.text();
  if (node?.kind() === "string") return stringValue(node);
  return null;
}

/** The member a container entry declares, or null for a spread, a computed key, or anything else. */
function entryName(entry: SgNode): string | null {
  const kind = String(entry.kind());
  if (SHORTHAND_KINDS.has(kind)) return entry.text();
  if (KEYED_ENTRY_KINDS.has(kind)) return nameText(entry.field("key"));
  if (NAMED_ENTRY_KINDS.has(kind)) return nameText(entry.field("name"));
  return null;
}

/** The container entry a legacy name node declares, or null when the node is not an entry's name. */
function declaringEntry(nameNode: SgNode): SgNode | null {
  if (SHORTHAND_KINDS.has(String(nameNode.kind()))) return nameNode;
  const parent = nameNode.parent();
  if (!parent || entryName(parent) !== LEGACY_HOOK) return null;
  const key = KEYED_ENTRY_KINDS.has(String(parent.kind()))
    ? parent.field("key")
    : parent.field("name");
  return key?.range().start.index === nameNode.range().start.index ? parent : null;
}

function legacyNameNodes(root: SgNode): SgNode[] {
  const identifiers = root.findAll({
    rule: {
      any: [
        { kind: "property_identifier" },
        { kind: "shorthand_property_identifier" },
        { kind: "shorthand_property_identifier_pattern" },
      ],
      regex: `^${LEGACY_HOOK}$`,
    },
  });
  const strings = root
    .findAll({ rule: { kind: "string" } })
    .filter(
      (node) =>
        stringValue(node) === LEGACY_HOOK &&
        STRING_NAME_PARENT_KINDS.has(String(node.parent()?.kind())),
    );
  return [...identifiers, ...strings];
}

function hookRenameEdit(node: SgNode): Edit {
  if (SHORTHAND_KINDS.has(String(node.kind()))) return node.replace(`${HOOK}: ${LEGACY_HOOK}`);
  if (node.kind() !== "string") return node.replace(HOOK);
  const quote = node.text()[0] ?? '"';
  return node.replace(`${quote}${HOOK}${quote}`);
}

/** Entries declaring the legacy hook in a container that also declares the new one. */
function conflictingEntries(nameNodes: SgNode[]): SgNode[] {
  return nameNodes.flatMap((node) => {
    const entry = declaringEntry(node);
    const container = entry?.parent();
    if (!entry || !container || !MEMBER_CONTAINER_KINDS.has(String(container.kind()))) return [];
    return container.children().some((sibling) => entryName(sibling) === HOOK) ? [entry] : [];
  });
}

function typeRenameEdits(root: SgNode, imports: SgNode[]): Edit[] {
  const edits: Edit[] = [];
  const taken = new Set([
    ...localDeclarationNames(root),
    ...imports.flatMap((stmt) => importBindings(stmt).map((binding) => binding.localName)),
  ]);
  const unaliased = new Map<string, string>();
  const namespaces = new Set<string>();

  for (const importStmt of imports) {
    if (importSource(importStmt) !== SDK_MODULE) continue;
    const namespaceImport = importStmt.find({ rule: { kind: "namespace_import" } });
    const namespaceName = namespaceImport?.find({ rule: { kind: "identifier" } })?.text();
    if (namespaceName) namespaces.add(namespaceName);

    const specs = importStmt.findAll({ rule: { kind: "import_specifier" } });
    const importedNames = new Set(specs.map((spec) => importSpecNames(spec)?.importedName));
    for (const spec of specs) {
      const names = importSpecNames(spec);
      const renamed = names && TYPE_RENAMES.get(names.importedName);
      if (!names || !renamed || importedNames.has(renamed)) continue;
      const isUnaliased = names.localName === names.importedName;
      if (isUnaliased && taken.has(renamed)) continue;
      const imported = spec.children().find((child) => child.kind() === "identifier");
      if (!imported) continue;
      edits.push(imported.replace(renamed));
      if (isUnaliased) unaliased.set(names.importedName, renamed);
    }
  }

  for (const reference of root.findAll({ rule: { kind: "type_identifier" } })) {
    const parent = reference.parent();
    if (parent?.kind() === "nested_type_identifier") {
      const qualifier = parent.children()[0]?.text();
      const renamed = TYPE_RENAMES.get(reference.text());
      if (qualifier && namespaces.has(qualifier) && renamed) edits.push(reference.replace(renamed));
      continue;
    }
    const renamed = unaliased.get(reference.text());
    if (renamed) edits.push(reference.replace(renamed));
  }

  for (const exportStmt of sdkReExports(root)) {
    const specs = exportStmt.findAll({ rule: { kind: "export_specifier" } });
    const exportedNames = new Set(specs.map((spec) => spec.field("name")?.text()));
    for (const spec of specs) {
      const name = spec.field("name");
      const renamed = name && TYPE_RENAMES.get(name.text());
      if (name && renamed && !exportedNames.has(renamed)) edits.push(name.replace(renamed));
    }
  }

  return edits;
}

interface Analysis {
  root: SgNode;
  edits: Edit[];
  conflicts: SgNode[];
}

function analyze(source: string, filePath: string): Analysis | null {
  if (!quickFilter(source)) return null;
  const root = parseRoot(source, filePath);
  if (!root) return null;

  const imports = findImportStatements(root);
  const referencesSdk =
    imports.some((stmt) => isSdkModule(importSource(stmt))) || sdkReExports(root).length > 0;
  if (!referencesSdk) return null;

  const nameNodes = legacyNameNodes(root);
  const conflicts = conflictingEntries(nameNodes);
  const hookEdits = conflicts.length > 0 ? [] : nameNodes.map(hookRenameEdit);
  return { root, edits: [...hookEdits, ...typeRenameEdits(root, imports)], conflicts };
}

/**
 * Rename the deprecated `onNamespaceLoaded` plugin hook to `onTailorDBNamespaceLoaded`, and the
 * `PluginNamespaceProcessContext` / `NamespacePluginOutput` types imported from the SDK to
 * `TailorDBNamespaceLoadedContext` / `TailorDBNamespacePluginOutput`.
 * @param source - File contents
 * @param filePath - Path to the file being transformed
 * @returns Transformed source, or null when nothing matched
 */
export default function transform(source: string, filePath = ""): string | null {
  const analysis = analyze(source, filePath);
  if (!analysis || analysis.edits.length === 0) return null;
  return analysis.root.commitEdits(analysis.edits);
}

/**
 * Report objects and classes that define both hook names, whose legacy hook this transform leaves
 * in place because renaming it would duplicate the new one.
 * @param source - File contents
 * @param filePath - Path to the file being reviewed
 * @param relativePath - Repository-relative path reported to the user
 * @returns Findings for hooks needing a manual merge
 */
export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  return (analyze(source, filePath)?.conflicts ?? []).map((entry) => ({
    file: relativePath,
    line: lineOf(entry),
    message: `This defines both ${HOOK} and the deprecated ${LEGACY_HOOK}, which the SDK rejects; merge ${LEGACY_HOOK} into ${HOOK} and delete it.`,
    excerpt: excerptOf(entry),
  }));
}
