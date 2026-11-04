import type { Edit, SgNode } from "@ast-grep/napi";

/**
 * Distinguish intrinsic JSX tag names from references to JavaScript bindings.
 * @param node - Identifier considered for renaming
 * @returns Whether this identifier names a lowercase JSX element
 */
export function isIntrinsicJsxName(node: SgNode): boolean {
  const parentKind = node.parent()?.kind();
  return (
    /^[a-z]/.test(node.text()) &&
    (parentKind === "jsx_opening_element" ||
      parentKind === "jsx_closing_element" ||
      parentKind === "jsx_self_closing_element")
  );
}

/**
 * Detect TypeScript value declarations and namespace exports that make a rename ambiguous.
 * @param root - Parsed source file
 * @param name - Name that must remain unambiguous
 * @returns Whether a declaration or namespace export uses the name
 */
function hasTypeScriptName(root: SgNode, name: string): boolean {
  for (const node of root.findAll({
    rule: {
      any: [
        { kind: "enum_declaration" },
        { kind: "internal_module" },
        { kind: "import_alias" },
        { kind: "import_require_clause" },
        { kind: "namespace_export" },
        { kind: "function_expression" },
        { kind: "generator_function" },
        { kind: "generator_function_declaration" },
        { kind: "class" },
      ],
    },
  })) {
    const binding =
      node.field("name") ?? node.children().find((child) => child.kind() === "identifier");
    if (binding?.text() === name) return true;
  }
  return false;
}

/**
 * Identify a conventional Tailor config module for config-only export migration.
 * @param filePath - Source path supplied by the codemod runner
 * @returns Whether the file is a Tailor config module
 */
export function isTailorConfigPath(filePath: string): boolean {
  return /(?:^|[/\\])tailor\.config\.[cm]?[jt]sx?$/.test(filePath);
}

/**
 * Whether a variable_declarator sits directly in a top-level `export const`/`export let`
 * statement, as opposed to inside a function body, block, or nested initializer (e.g. a
 * property value). Only a declarator in this position creates a module export.
 * @param decl - The variable_declarator to check
 * @returns True when `decl` is a top-level exported declarator
 */
export function isTopLevelExportedDeclarator(decl: SgNode): boolean {
  const declList = decl.parent();
  if (!declList) return false;
  const listKind = declList.kind();
  if (listKind !== "lexical_declaration" && listKind !== "variable_declaration") return false;
  const exportStmt = declList.parent();
  if (!exportStmt || exportStmt.kind() !== "export_statement") return false;
  return exportStmt.parent()?.kind() === "program";
}

/**
 * Whether a parameter/catch-clause binding pattern binds `name`, recursing into
 * destructured object/array patterns.
 * @param pat - A pattern node (identifier, object_pattern, array_pattern, ...)
 * @param name - Binding name to look for
 * @returns True when `pat` binds `name`
 */
export function patternBindsName(pat: SgNode, name: string): boolean {
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
export function fileAlreadyBindsPlugins(root: SgNode): boolean {
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
export function hasOtherBindingNamed(root: SgNode, name: string, excludeStart: number): boolean {
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
 * @param preserveExportNames - Keep public names in modules other than Tailor configs
 */
export function renameBindingAndUsages(
  root: SgNode,
  declNode: SgNode,
  oldName: string,
  edits: Edit[],
  preserveExportNames: boolean,
): void {
  edits.push(declNode.replace("plugins"));
  const declStart = declNode.range().start.index;
  for (const idNode of root.findAll({ rule: { kind: "identifier", regex: `^${oldName}$` } })) {
    if (isIntrinsicJsxName(idNode)) continue;
    if (idNode.range().start.index === declStart) continue;
    if (idNode.parent()?.kind() === "import_specifier") continue;
    const exportSpec = idNode.parent();
    if (exportSpec?.kind() === "export_specifier") {
      if (exportSpec.parent()?.parent()?.field("source")) continue;
      if (exportSpec.field("alias")?.range().start.index === idNode.range().start.index) continue;
      if (preserveExportNames && !exportSpec.field("alias")) {
        edits.push(idNode.replace(`plugins as ${oldName}`));
        continue;
      }
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
