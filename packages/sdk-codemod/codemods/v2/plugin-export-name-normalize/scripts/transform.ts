import * as fs from "node:fs";
import { parse, Lang } from "@ast-grep/napi";
import * as path from "pathe";
import { hasTypeScriptName } from "../../../../src/plugin-export-bindings";
import type { Edit, SgNode } from "@ast-grep/napi";

const OLD_NAMES = ["generator", "generators"] as const;
const CONFIG_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

/**
 * Whether a call expression node is a call to `definePlugins`.
 * @param node - Node to check, or null
 * @returns True when the node is `definePlugins(...)`
 */
function isDefinePluginsCall(node: SgNode | null | undefined): boolean {
  if (!node || node.kind() !== "call_expression") return false;
  const callee = node.field("function");
  return callee?.kind() === "identifier" && callee.text() === "definePlugins";
}

/**
 * Whether a variable_declarator sits directly in a top-level `export const`/`export let`
 * statement, as opposed to inside a function body, block, or nested initializer (e.g. a
 * property value). Only a declarator in this position creates a module export.
 * @param decl - The variable_declarator to check
 * @returns True when `decl` is a top-level exported declarator
 */
function isTopLevelExportedDeclarator(decl: SgNode): boolean {
  const declList = decl.parent();
  if (!declList) return false;
  const listKind = declList.kind();
  if (listKind !== "lexical_declaration" && listKind !== "variable_declaration") return false;
  const exportStmt = declList.parent();
  if (!exportStmt || exportStmt.kind() !== "export_statement") return false;
  return exportStmt.parent()?.kind() === "program";
}

/**
 * Find `generator`/`generators` variable declarators whose value is a `definePlugins()` call
 * and which are themselves a top-level module export.
 * @param root - File root node
 * @returns Matching declarators, in source order
 */
function findRenamableDeclarators(root: SgNode): SgNode[] {
  const result: SgNode[] = [];
  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const nameNode = decl.field("name");
    if (nameNode?.kind() !== "identifier") continue;
    if (!(OLD_NAMES as readonly string[]).includes(nameNode.text())) continue;
    if (!isDefinePluginsCall(decl.field("value"))) continue;
    if (!isTopLevelExportedDeclarator(decl)) continue;
    result.push(decl);
  }
  return result;
}

/**
 * Whether an import statement's module specifier looks like it targets a tailor.config module.
 * @param sourceText - The raw (quoted) text of the import's string literal
 * @returns True for `"./tailor.config"`, `"../foo/tailor.config.ts"`, etc.
 */
function isTailorConfigImportSource(sourceText: string): boolean {
  const raw = sourceText.replace(/^["']|["']$/g, "");
  const withoutExt = raw.replace(/\.(ts|tsx|js|mjs|cjs|mts|cts)$/, "");
  return /(^|\/)tailor\.config$/.test(withoutExt);
}

interface TailorConfigSpecifier {
  spec: SgNode;
  modulePath: string;
}

/**
 * Find `import { generator[s] [as alias] }` specifiers imported from a tailor.config module.
 * @param root - File root node
 * @returns Matching import specifiers with their (raw, quoted-stripped) module path, in source order
 */
function findTailorConfigGeneratorSpecifiers(root: SgNode): TailorConfigSpecifier[] {
  const result: TailorConfigSpecifier[] = [];
  for (const stmt of root.findAll({ rule: { kind: "import_statement" } })) {
    const stringNode = stmt.find({ rule: { kind: "string" } });
    if (!stringNode || !isTailorConfigImportSource(stringNode.text())) continue;
    const modulePath = stringNode.text().replace(/^["']|["']$/g, "");
    for (const spec of stmt.findAll({ rule: { kind: "import_specifier" } })) {
      const nameNode = spec.field("name");
      if (nameNode && (OLD_NAMES as readonly string[]).includes(nameNode.text())) {
        result.push({ spec, modulePath });
      }
    }
  }
  return result;
}

/**
 * Whether a parameter/catch-clause binding pattern binds `name`, recursing into
 * destructured object/array patterns.
 * @param pat - A pattern node (identifier, object_pattern, array_pattern, ...)
 * @param name - Binding name to look for
 * @returns True when `pat` binds `name`
 */
function patternBindsName(pat: SgNode, name: string): boolean {
  const kind = pat.kind();
  if (kind === "identifier" || kind === "shorthand_property_identifier_pattern") {
    return pat.text() === name;
  }
  if (
    kind === "object_pattern" ||
    kind === "array_pattern" ||
    kind === "rest_pattern" ||
    kind === "assignment_pattern"
  ) {
    return pat.children().some((c: SgNode) => patternBindsName(c, name));
  }
  if (kind === "object_assignment_pattern") {
    const left = pat.field("left");
    return left ? patternBindsName(left, name) : false;
  }
  if (kind === "pair_pattern") {
    const value = pat.field("value");
    return value ? patternBindsName(value, name) : false;
  }
  return false;
}

/**
 * Whether `name` is bound by a default or namespace (`* as name`) import clause anywhere
 * in the file.
 * @param root - File root node
 * @param name - Binding name to look for
 * @returns True when `name` is bound this way
 */
function isBoundByDefaultOrNamespaceImport(root: SgNode, name: string): boolean {
  for (const clause of root.findAll({ rule: { kind: "import_clause" } })) {
    for (const child of clause.children()) {
      if (child.kind() === "identifier" && child.text() === name) return true;
      if (child.kind() === "namespace_import") {
        const ident = child.children().find((c: SgNode) => c.kind() === "identifier");
        if (ident?.text() === name) return true;
      }
    }
  }
  return false;
}

/**
 * Whether the file already binds the name `plugins`, as a top-level variable (including a
 * destructured one), a function/class declaration, or an imported (possibly aliased,
 * default, or namespace) specifier. Used to avoid a rename that would collide.
 * @param root - File root node
 * @returns True if a `plugins` binding already exists
 */
function fileAlreadyBindsPlugins(root: SgNode): boolean {
  if (hasTypeScriptName(root, "plugins")) return true;
  for (const spec of root.findAll({ rule: { kind: "export_specifier" } })) {
    if ((spec.field("alias") ?? spec.field("name"))?.text() === "plugins") return true;
  }
  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const nameNode = decl.field("name");
    if (nameNode && patternBindsName(nameNode, "plugins")) return true;
  }
  for (const fn of root.findAll({ rule: { kind: "function_declaration" } })) {
    if (fn.field("name")?.text() === "plugins") return true;
  }
  for (const cls of root.findAll({ rule: { kind: "class_declaration" } })) {
    if (cls.field("name")?.text() === "plugins") return true;
  }
  for (const spec of root.findAll({ rule: { kind: "import_specifier" } })) {
    const local = spec.field("alias") ?? spec.field("name");
    if (local?.text() === "plugins") return true;
  }
  return (
    isBoundByDefaultOrNamespaceImport(root, "plugins") ||
    isBoundAsParameterAnywhere(root, "plugins")
  );
}

/**
 * Whether `name` is bound as a function/arrow/method parameter or a catch clause parameter
 * anywhere in the file. A rename that renames every bare identifier with a matching name
 * must not touch a name shadowed this way — the shadowing declaration and the references
 * inside its scope are unrelated to the binding being renamed, and a plain text-match
 * cannot tell the two apart.
 * @param root - File root node
 * @param name - Binding name to look for
 * @returns True when `name` is bound as a parameter somewhere
 */
function isBoundAsParameterAnywhere(root: SgNode, name: string): boolean {
  for (const param of root.findAll({
    rule: { any: [{ kind: "required_parameter" }, { kind: "optional_parameter" }] },
  })) {
    const pat = param.field("pattern");
    if (pat && patternBindsName(pat, name)) return true;
  }
  for (const formalParams of root.findAll({ rule: { kind: "formal_parameters" } })) {
    for (const child of formalParams.children()) {
      if (
        (child.kind() === "identifier" ||
          child.kind() === "object_pattern" ||
          child.kind() === "array_pattern") &&
        patternBindsName(child, name)
      ) {
        return true;
      }
    }
  }
  for (const arrow of root.findAll({ rule: { kind: "arrow_function" } })) {
    const single = arrow.field("parameter");
    if (single && patternBindsName(single, name)) return true;
  }
  for (const catchClause of root.findAll({ rule: { kind: "catch_clause" } })) {
    for (const child of catchClause.children()) {
      if (patternBindsName(child, name)) return true;
    }
  }
  return false;
}

/**
 * Whether some other binding in the file already uses `name` (excluding the node at
 * `excludeStart`): a top-level variable/function/class, another import specifier, or a
 * parameter/catch-clause pattern anywhere. A rename that also rewrites bare identifier
 * usages must not proceed when this is true, since a plain text-match rename cannot tell
 * a reference to the binding being renamed apart from a reference to the other one.
 * @param root - File root node
 * @param name - Binding name to look for
 * @param excludeStart - Byte offset of the node being renamed, excluded from the search
 * @returns True when another binding for `name` exists
 */
function hasOtherBindingNamed(root: SgNode, name: string, excludeStart: number): boolean {
  if (hasTypeScriptName(root, name)) return true;
  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const nameNode = decl.field("name");
    if (!nameNode) continue;
    if (nameNode.kind() === "identifier") {
      if (nameNode.text() !== name) continue;
      if (nameNode.range().start.index === excludeStart) continue;
      return true;
    }
    if (patternBindsName(nameNode, name)) return true;
  }
  for (const fn of root.findAll({ rule: { kind: "function_declaration" } })) {
    const nameNode = fn.field("name");
    if (nameNode?.text() !== name) continue;
    if (nameNode.range().start.index === excludeStart) continue;
    return true;
  }
  for (const cls of root.findAll({ rule: { kind: "class_declaration" } })) {
    const nameNode = cls.field("name");
    if (nameNode?.text() !== name) continue;
    if (nameNode.range().start.index === excludeStart) continue;
    return true;
  }
  for (const spec of root.findAll({ rule: { kind: "import_specifier" } })) {
    const local = spec.field("alias") ?? spec.field("name");
    if (local?.text() !== name) continue;
    if (local.range().start.index === excludeStart) continue;
    return true;
  }
  if (isBoundByDefaultOrNamespaceImport(root, name)) return true;
  return isBoundAsParameterAnywhere(root, name);
}

/**
 * Rename a binding's declaration/specifier node and every other bare identifier reference
 * to it in the file (the caller has already checked, via {@link hasOtherBindingNamed}, that
 * no shadowing binding makes this ambiguous).
 * @param root - File root node
 * @param declNode - The declaration/specifier name node to rename
 * @param oldName - The binding's current name
 * @param edits - Edit list to append to
 */
function renameBindingAndUsages(
  root: SgNode,
  declNode: SgNode,
  oldName: string,
  edits: Edit[],
): void {
  edits.push(declNode.replace("plugins"));
  const declStart = declNode.range().start.index;
  for (const idNode of root.findAll({ rule: { kind: "identifier", regex: `^${oldName}$` } })) {
    if (idNode.range().start.index === declStart) continue;
    if (idNode.parent()?.kind() === "import_specifier") continue;
    const exportSpec = idNode.parent();
    if (exportSpec?.kind() === "export_specifier") {
      if (exportSpec.parent()?.parent()?.field("source")) continue;
      if (exportSpec.field("alias")?.range().start.index === idNode.range().start.index) continue;
    }
    edits.push(idNode.replace("plugins"));
  }
  // A shorthand `{ oldName }` is both the object key and the value reference; replacing the
  // whole node would rename the key too (`{ oldName }` -> `{ plugins }`, not `{ oldName:
  // plugins }`), silently changing the object's shape. Expand it to an explicit pair instead,
  // so only the referenced value is renamed.
  for (const idNode of root.findAll({
    rule: { kind: "shorthand_property_identifier", regex: `^${oldName}$` },
  })) {
    edits.push(idNode.replace(`${oldName}: plugins`));
  }
}

/**
 * Resolve a relative module specifier to a file on disk, trying each config extension.
 * @param filePath - Absolute path of the file containing the import
 * @param rawSpecifier - The import's (unquoted) module specifier
 * @returns The resolved absolute path, or null when not relative or not found
 */
function resolveRelativeModule(filePath: string, rawSpecifier: string): string | null {
  if (!rawSpecifier.startsWith(".")) return null;
  const baseDir = path.dirname(filePath);
  const asIs = path.resolve(baseDir, rawSpecifier);
  if (fs.existsSync(asIs)) return asIs;
  const withoutExt = rawSpecifier.replace(/\.(ts|tsx|js|mjs|cjs|mts|cts)$/, "");
  for (const ext of CONFIG_EXTENSIONS) {
    const candidate = path.resolve(baseDir, withoutExt + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Whether the config module still exports `oldName`, including unrelated exports.
 * @param configTree - Parsed root of the config module
 * @param oldName - Binding name to look for
 * @returns True when `oldName` is still its own top-level export
 */
function stillExportsOwnName(configTree: SgNode, oldName: string): boolean {
  return configTree.children().some((stmt) => {
    if (stmt.kind() !== "export_statement") return false;
    if (stmt.children().some((child) => child.kind() === "*")) return true;
    const declaration = stmt.field("declaration");
    if (declaration?.field("name")?.text() === oldName) return true;
    if (
      declaration?.children().some((child) => {
        const name = child.kind() === "variable_declarator" ? child.field("name") : null;
        return name ? patternBindsName(name, oldName) : false;
      })
    )
      return true;
    return stmt
      .findAll({ rule: { kind: "export_specifier" } })
      .some((spec) => (spec.field("alias") ?? spec.field("name"))?.text() === oldName);
  });
}

/**
 * Whether the config module has settled on `plugins` as a top-level `definePlugins()` export.
 * @param configTree - Parsed root of the config module
 * @returns True when a `plugins` export of the right shape exists
 */
function hasSettledPluginsExport(configTree: SgNode): boolean {
  return configTree.findAll({ rule: { kind: "variable_declarator" } }).some((decl) => {
    const nameNode = decl.field("name");
    return (
      nameNode?.kind() === "identifier" &&
      nameNode.text() === "plugins" &&
      isDefinePluginsCall(decl.field("value")) &&
      isTopLevelExportedDeclarator(decl)
    );
  });
}

/**
 * Whether the tailor.config module an import specifier points at either already exports
 * `plugins` (as a `definePlugins()` binding, with `oldName` no longer present under its own
 * name), or still exports `oldName` and would itself safely rename it to `plugins` (a single
 * matching top-level export, with no collision or shadowing binding). Renaming the importer
 * ahead of an unverifiable or unrenameable source would import a name the source does not
 * (yet, or ever) actually export — including the case where the source keeps `oldName` as its
 * own export (because renaming it would collide with an unrelated existing `plugins`), which
 * an importer must keep referring to as `oldName`, not `plugins`.
 * @param filePath - Absolute path of the file containing the import
 * @param modulePath - The import's (unquoted) module specifier
 * @param oldName - The imported (remote) binding name being considered for rename
 * @returns True when it is safe to rename this import to `plugins`
 */
function sourceConfigRenameIsSafe(filePath: string, modulePath: string, oldName: string): boolean {
  const resolved = resolveRelativeModule(filePath, modulePath);
  if (!resolved) return false;

  let configSource: string;
  try {
    configSource = fs.readFileSync(resolved, "utf-8");
  } catch {
    return false;
  }

  const configTree = parse(Lang.TypeScript, configSource).root();

  if (!stillExportsOwnName(configTree, oldName)) {
    // Already migrated (or never existed under this name at all): safe only if `plugins`
    // is the settled result.
    return hasSettledPluginsExport(configTree);
  }

  // Still exported under the old name: safe only if that export's own rename would not
  // itself collide (including with an unrelated existing `plugins`).
  if (fileAlreadyBindsPlugins(configTree)) return false;
  const matching = findRenamableDeclarators(configTree);
  if (matching.length !== 1 || matching[0]!.field("name")?.text() !== oldName) return false;
  const nameNode = matching[0]!.field("name")!;
  return !hasOtherBindingNamed(configTree, oldName, nameNode.range().start.index);
}

/**
 * Normalize the plugin config export name to `plugins`:
 *
 * 1. `export const generator|generators = definePlugins(...)` → `export const plugins = ...`,
 *    with any other same-file reference to the old name renamed to match.
 * 2. `import { generator|generators [as alias] } from ".../tailor.config"` → renamed to
 *    `plugins` (keeping any existing alias), with bare local usages renamed to match when
 *    there was no alias.
 *
 * A rename is skipped — leaving that binding (and its usages) untouched — when: the file
 * already binds `plugins` to something else; the old name is also bound by another
 * declaration, import, or parameter anywhere in the file (a plain text-match rename cannot
 * tell such a reference apart from a reference to the binding being renamed); a file has more
 * than one legacy plugin export candidate (renaming both to `plugins` would collide); or, for
 * an import, the imported module cannot be read and confirmed to itself export `plugins`
 * safely.
 * @param source - Source code to transform
 * @param filePath - Absolute path of the file being transformed, used to resolve
 *   `import { ... } from ".../tailor.config"` specifiers against the actual module on disk
 * @returns Transformed source or null if no changes needed
 */
export default function transform(source: string, filePath?: string): string | null {
  if (!source.includes("generator")) return null;

  const tree = parse(Lang.TypeScript, source).root();

  const declarators = findRenamableDeclarators(tree);
  const importSpecifiers = findTailorConfigGeneratorSpecifiers(tree);
  if (declarators.length === 0 && importSpecifiers.length === 0) return null;

  const hasPluginsCollision = fileAlreadyBindsPlugins(tree);
  const localRenames: Array<{ node: SgNode; oldName: string }> = [];
  const remoteRenames: SgNode[] = [];

  // Collect the edits before applying any: individually safe renames can collide with
  // each other when two different local bindings would both become `plugins`.
  if (!hasPluginsCollision && declarators.length === 1) {
    const nameNode = declarators[0]!.field("name")!;
    const oldName = nameNode.text();
    if (!hasOtherBindingNamed(tree, oldName, nameNode.range().start.index)) {
      localRenames.push({ node: nameNode, oldName });
    }
  }

  for (const { spec, modulePath } of importSpecifiers) {
    const importedNode = spec.field("name");
    if (!importedNode) continue;
    const oldName = importedNode.text();
    if (!filePath || !sourceConfigRenameIsSafe(filePath, modulePath, oldName)) continue;

    if (spec.field("alias")) {
      // An alias only needs its remote name updated, even when its local name is `plugins`.
      remoteRenames.push(importedNode);
    } else if (
      !hasPluginsCollision &&
      !hasOtherBindingNamed(tree, oldName, importedNode.range().start.index)
    ) {
      localRenames.push({ node: importedNode, oldName });
    }
  }

  if (localRenames.length > 1) return null;
  const edits: Edit[] = remoteRenames.map((node) => node.replace("plugins"));
  for (const { node, oldName } of localRenames) {
    renameBindingAndUsages(tree, node, oldName, edits);
  }

  if (edits.length === 0) return null;

  return tree.commitEdits(edits);
}

export { reviewFindings } from "../../../../src/plugin-export-review";
