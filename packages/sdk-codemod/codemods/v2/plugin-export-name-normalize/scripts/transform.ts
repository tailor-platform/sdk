import * as fs from "node:fs";
import { parse, Lang } from "@ast-grep/napi";
import * as path from "pathe";
import {
  fileAlreadyBindsPlugins,
  hasOtherBindingNamed,
  isTailorConfigPath,
  isTopLevelExportedDeclarator,
  patternBindsName,
  renameBindingAndUsages,
} from "../../../../src/plugin-export-bindings";
import migrateDefineGenerators from "../../define-generators-to-plugins/scripts/transform";
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
 * Check whether the factory lacks an unambiguous direct SDK import.
 * @param root - Parsed config module
 * @returns Whether definePlugins cannot be verified as the SDK factory
 */
function hasUnrelatedFactoryBinding(root: SgNode): boolean {
  let sdkBindingStart = -1;
  for (const stmt of root.children().filter((node) => node.kind() === "import_statement")) {
    if (stmt.field("source")?.text().slice(1, -1) !== "@tailor-platform/sdk") continue;
    for (const spec of stmt.findAll({ rule: { kind: "import_specifier" } })) {
      const imported = spec.field("name");
      const local = spec.field("alias") ?? imported;
      if (imported?.text() === "definePlugins" && local?.text() === "definePlugins") {
        sdkBindingStart = local.range().start.index;
      }
    }
  }
  return sdkBindingStart === -1 || hasOtherBindingNamed(root, "definePlugins", sdkBindingStart);
}

/**
 * Find `generator`/`generators` variable declarators whose value is a `definePlugins()` call
 * and which are themselves a top-level module export.
 * @param root - File root node
 * @returns Matching declarators, in source order
 */
function findRenamableDeclarators(root: SgNode): SgNode[] {
  if (hasUnrelatedFactoryBinding(root)) return [];
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
  // Only emitted JavaScript extensions can substitute TypeScript source files.
  const sourceExtensions: Record<string, string[]> = {
    ".js": [".ts", ".tsx"],
    ".mjs": [".mts"],
    ".cjs": [".cts"],
  };
  const extension = path.extname(rawSpecifier);
  // The final `.config` is part of an extensionless tailor.config module name.
  const extensions =
    extension === ".config" ? CONFIG_EXTENSIONS : (sourceExtensions[extension] ?? []);
  const withoutExt = rawSpecifier.replace(/\.(ts|tsx|js|mjs|cjs|mts|cts)$/, "");
  for (const ext of extensions) {
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
  if (hasUnrelatedFactoryBinding(configTree)) return false;
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
  configSource = migrateDefineGenerators(configSource, resolved) ?? configSource;

  const configTree = parse(
    resolved.endsWith(".tsx") ? Lang.Tsx : Lang.TypeScript,
    configSource,
  ).root();

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

  const tree = parse(filePath?.endsWith(".tsx") ? Lang.Tsx : Lang.TypeScript, source).root();

  const declarators =
    !filePath || isTailorConfigPath(filePath) ? findRenamableDeclarators(tree) : [];
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
    renameBindingAndUsages(tree, node, oldName, edits, !!filePath && !isTailorConfigPath(filePath));
  }

  if (edits.length === 0) return null;

  return tree.commitEdits(edits);
}

export { reviewFindings } from "../../../../src/plugin-export-review";
