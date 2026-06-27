import { parse, Lang } from "@ast-grep/napi";
import type { Edit, SgNode } from "@ast-grep/napi";

const RUNTIME_MODULE = "@tailor-platform/sdk/runtime";
const TAILOR_IDP_CLIENT = "tailor.idp.Client";

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

  for (const child of node.children()) {
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
        { kind: "class_declaration" },
        { kind: "interface_declaration" },
        { kind: "type_alias_declaration" },
        { kind: "enum_declaration" },
      ],
    },
  })) {
    const name = decl
      .children()
      .find((child) => child.kind() === "identifier" || child.kind() === "type_identifier");
    if (name) names.add(name.text());
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

function hasCollision(imports: SgNode[], localNames: Set<string>): boolean {
  if (localNames.has("tailor") || localNames.has("idp")) return true;

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

function importInsertionIndex(imports: SgNode[], source: string): number {
  const lastImport = imports.at(-1);
  if (lastImport) return lastImport.range().end.index;

  if (source.startsWith("#!")) {
    const newlineIndex = source.indexOf("\n");
    return newlineIndex === -1 ? source.length : newlineIndex + 1;
  }

  return 0;
}

function buildAddRuntimeImportEdit(source: string, imports: SgNode[]): Edit {
  const existingRuntimeImport = runtimeNamedValueImport(imports);
  const namedImports = existingRuntimeImport ? namedImportsNode(existingRuntimeImport) : null;
  if (namedImports) {
    const specTexts = namedImports
      .findAll({ rule: { kind: "import_specifier" } })
      .map((spec) => spec.text());
    return namedImports.replace(`{ ${[...specTexts, "idp"].join(", ")} }`);
  }

  const pos = importInsertionIndex(imports, source);
  const insertedText =
    pos === 0 || (pos > 0 && source[pos - 1] === "\n")
      ? `import { idp } from "${RUNTIME_MODULE}";\n\n`
      : `\nimport { idp } from "${RUNTIME_MODULE}";`;
  return { startPos: pos, endPos: pos, insertedText };
}

function findTailorIdpClientConstructors(root: SgNode): SgNode[] {
  return root
    .findAll({ rule: { kind: "new_expression" } })
    .map((node) => node.field("constructor"))
    .filter((node): node is SgNode => node?.text() === TAILOR_IDP_CLIENT);
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
  if (hasCollision(imports, localDeclarationNames(root))) return null;

  const existingIdpLocal = runtimeIdpLocalName(imports);
  const idpLocal = existingIdpLocal ?? "idp";
  const edits: Edit[] = constructors.map((constructor) =>
    constructor.replace(`${idpLocal}.Client`),
  );

  if (!existingIdpLocal) {
    edits.push(buildAddRuntimeImportEdit(source, imports));
  }

  const result = root.commitEdits(edits);
  return result === source ? null : result;
}
