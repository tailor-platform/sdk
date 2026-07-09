import { parse, Lang } from "@ast-grep/napi";
import {
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

function existingSelfNamespaceLocal(importStmt: SgNode, mod: RuntimeModule): string | null {
  for (const spec of importStmt.findAll({ rule: { kind: "import_specifier" } })) {
    const names = importSpecNames(spec);
    if (!names || names.typeOnly || names.importedName !== mod.namespace) continue;
    return names.localName;
  }
  return null;
}

function buildImportReplacement(
  importStmt: SgNode,
  mod: RuntimeModule,
  root: SgNode,
  imports: SgNode[],
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

  const existingSelfLocal = existingSelfNamespaceLocal(importStmt, mod);
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
  const declaredNames = localDeclarationNames(root);
  if (flatImports.some((binding) => declaredNames.has(binding.localName))) return null;
  if (hasExportSpecifierReference(root, removedNames)) return null;

  const namespaceLocal =
    !statementTypeOnly && defaultName
      ? defaultName
      : (existingSelfLocal ?? uniqueNamespaceLocal(mod, root, imports, removedNames));
  const nextNamedSpecs =
    (!statementTypeOnly && defaultName) || existingSelfLocal
      ? keptSpecs
      : [selfNamespaceSpec(mod, namespaceLocal), ...keptSpecs];

  return {
    edit: importStmt.replace(
      formatImport(
        source,
        statementTypeOnly ? null : defaultName,
        nextNamedSpecs,
        statementTypeOnly,
      ),
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
    if (byLocalName.get(node.text())?.typeOnly && !isInsideTypeQuery(node)) continue;
    const replacement = replacementFor(node.text());
    if (!replacement) continue;
    edits.push(node.replace(replacement));
  }

  for (const node of root.findAll({ rule: { kind: "type_identifier" } })) {
    if (isInsideImportStatement(node)) continue;
    if (isInsideExportSpecifier(node)) continue;
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

  for (const importStmt of imports) {
    const sourceName = importSource(importStmt);
    if (!sourceName) continue;
    const mod = MODULES_BY_SOURCE.get(sourceName);
    if (!mod) continue;

    const replacement = buildImportReplacement(importStmt, mod, root, imports);
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

export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  if (!quickFilter(source)) return [];

  const root = parse(sourceLang(filePath, source), source).root();
  const findings: LlmReviewFinding[] = [];

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
    if (!mod || !hasRemovedFlatSpecifier(exportStmt, mod)) continue;

    findings.push({
      file: relativePath,
      line: exportStmt.range().start.line + 1,
      message: "Runtime subpath re-export still uses a removed flat value export.",
      excerpt: exportStmt.text().trim(),
    });
  }

  return findings;
}
