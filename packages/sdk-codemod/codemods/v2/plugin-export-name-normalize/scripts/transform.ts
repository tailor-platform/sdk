import { parse, Lang } from "@ast-grep/napi";
import type { Edit, SgNode } from "@ast-grep/napi";

const OLD_NAMES = ["generator", "generators"] as const;

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
 * Find `generator`/`generators` variable declarators whose value is a `definePlugins()` call.
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
  const withoutExt = raw.replace(/\.(ts|tsx|js|mjs|cjs)$/, "");
  return /(^|\/)tailor\.config$/.test(withoutExt);
}

/**
 * Find `import { generator[s] [as alias] }` specifiers imported from a tailor.config module.
 * @param root - File root node
 * @returns Matching import specifiers, in source order
 */
function findTailorConfigGeneratorSpecifiers(root: SgNode): SgNode[] {
  const result: SgNode[] = [];
  for (const stmt of root.findAll({ rule: { kind: "import_statement" } })) {
    const stringNode = stmt.find({ rule: { kind: "string" } });
    if (!stringNode || !isTailorConfigImportSource(stringNode.text())) continue;
    for (const spec of stmt.findAll({ rule: { kind: "import_specifier" } })) {
      const nameNode = spec.field("name");
      if (nameNode && (OLD_NAMES as readonly string[]).includes(nameNode.text())) {
        result.push(spec);
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
  return isBoundByDefaultOrNamespaceImport(root, "plugins");
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
 * Normalize the plugin config export name to `plugins`:
 *
 * 1. `export const generator|generators = definePlugins(...)` → `export const plugins = ...`,
 *    with any other same-file reference to the old name renamed to match.
 * 2. `import { generator|generators [as alias] } from ".../tailor.config"` → renamed to
 *    `plugins` (keeping any existing alias), with bare local usages renamed to match when
 *    there was no alias.
 *
 * A rename is skipped — leaving that binding (and its usages) untouched — when the file
 * already binds `plugins` to something else, or when the old name is also bound by another
 * declaration, import, or parameter anywhere in the file: a plain text-match rename cannot
 * tell such a reference apart from a reference to the binding being renamed.
 * @param source - Source code to transform
 * @returns Transformed source or null if no changes needed
 */
export default function transform(source: string): string | null {
  if (!source.includes("generator")) return null;

  const tree = parse(Lang.TypeScript, source).root();

  const declarators = findRenamableDeclarators(tree);
  const importSpecifiers = findTailorConfigGeneratorSpecifiers(tree);
  if (declarators.length === 0 && importSpecifiers.length === 0) return null;

  if (fileAlreadyBindsPlugins(tree)) return null;

  const edits: Edit[] = [];

  for (const decl of declarators) {
    const nameNode = decl.field("name");
    if (!nameNode) continue;
    const oldName = nameNode.text();
    if (hasOtherBindingNamed(tree, oldName, nameNode.range().start.index)) continue;
    renameBindingAndUsages(tree, nameNode, oldName, edits);
  }

  for (const spec of importSpecifiers) {
    const importedNode = spec.field("name");
    if (!importedNode) continue;

    const aliasNode = spec.field("alias");
    if (aliasNode) {
      // Only the remote name changes; the local binding (the alias) is untouched.
      edits.push(importedNode.replace("plugins"));
      continue;
    }

    const oldName = importedNode.text();
    if (hasOtherBindingNamed(tree, oldName, importedNode.range().start.index)) continue;
    renameBindingAndUsages(tree, importedNode, oldName, edits);
  }

  if (edits.length === 0) return null;

  return tree.commitEdits(edits);
}
