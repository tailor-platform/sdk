import { parse, Lang } from "@ast-grep/napi";
import {
  hasTypeScriptName,
  isTailorConfigPath,
  isIntrinsicJsxName,
} from "../../../../src/plugin-export-bindings";
import type { Edit, SgNode } from "@ast-grep/napi";

/**
 * Known plugin mappings from package name to plugin function/import.
 */
const PLUGIN_MAP: Record<string, { functionName: string; importPath: string }> = {
  "@tailor-platform/kysely-type": {
    functionName: "kyselyTypePlugin",
    importPath: "@tailor-platform/sdk/plugin/kysely-type",
  },
  "@tailor-platform/seed": {
    functionName: "seedPlugin",
    importPath: "@tailor-platform/sdk/plugin/seed",
  },
  "@tailor-platform/enum-constants": {
    functionName: "enumConstantsPlugin",
    importPath: "@tailor-platform/sdk/plugin/enum-constants",
  },
  "@tailor-platform/file-utils": {
    functionName: "fileUtilsPlugin",
    importPath: "@tailor-platform/sdk/plugin/file-utils",
  },
};

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
 * Find the variable_declarator that directly initializes a node — i.e. `node` is the
 * declarator's `value`, not merely nested somewhere inside it (e.g. a property value in an
 * object literal). Only matches a top-level exported declarator.
 * @param node - Node to check
 * @returns The declarator, or undefined if `node` is not a top-level export's direct initializer
 */
function findEnclosingDeclarator(node: SgNode): SgNode | undefined {
  const parent = node.parent();
  if (!parent || parent.kind() !== "variable_declarator") return undefined;
  if (parent.field("value")?.range().start.index !== node.range().start.index) return undefined;
  if (!isTopLevelExportedDeclarator(parent)) return undefined;
  return parent;
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
    const idents = spec.children().filter((c: SgNode) => c.kind() === "identifier");
    const local = idents[idents.length - 1];
    if (local?.text() === "plugins") return true;
  }
  return (
    isBoundByDefaultOrNamespaceImport(root, "plugins") ||
    isBoundAsParameterAnywhere(root, "plugins")
  );
}

/**
 * Whether some other binding in the file already uses `name` (excluding the node at
 * `excludeStart`): a top-level variable/function/class, an import specifier, or a
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
    const idents = spec.children().filter((c: SgNode) => c.kind() === "identifier");
    const local = idents[idents.length - 1];
    if (local?.text() !== name) continue;
    if (local.range().start.index === excludeStart) continue;
    return true;
  }
  if (isBoundByDefaultOrNamespaceImport(root, name)) return true;
  return isBoundAsParameterAnywhere(root, name);
}

/**
 * Rename a declarator's name node and every other bare identifier reference to it in the
 * file (the caller has already checked, via {@link hasOtherBindingNamed}, that no shadowing
 * binding makes this ambiguous).
 * @param root - File root node
 * @param declNode - The declarator's name node to rename
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
    if (isIntrinsicJsxName(idNode)) continue;
    if (idNode.range().start.index === declStart) continue;
    if (idNode.parent()?.kind() === "import_specifier") continue;
    const exportSpec = idNode.parent();
    if (exportSpec?.kind() === "export_specifier") {
      if (exportSpec.parent()?.parent()?.field("source")) continue;
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
 * Transform defineGenerators() to definePlugins():
 *
 * 1. Rename `defineGenerators` → `definePlugins` in import and call
 * 2. Transform tuple arguments `["pkg-name", config]` → `pluginFn(config)`
 * 3. Add plugin imports from their respective SDK paths
 * 4. Rename the export variable to `plugins`, the official plugin config export name
 *    (skipping the whole file when `plugins` is already bound to something else)
 * @param source - Source code to transform
 * @param filePath - Source path, used to restrict export renames to config modules
 * @returns Transformed source or null if no changes needed
 */
export default function transform(source: string, filePath?: string): string | null {
  const tree = parse(filePath?.endsWith(".tsx") ? Lang.Tsx : Lang.TypeScript, source).root();

  // Only process files that import defineGenerators from the SDK.
  // This prevents modifying unrelated files that happen to contain the identifier.
  if (!source.includes("defineGenerators")) {
    return null;
  }
  if (!source.includes("@tailor-platform/sdk")) {
    return null;
  }

  const edits: Edit[] = [];
  const importsToAdd: Map<string, string> = new Map(); // importPath -> functionName

  // Step 1: Find and transform defineGenerators call arguments (tuples → plugin calls)
  const callNodes = tree.findAll({
    rule: {
      pattern: "defineGenerators($$$ARGS)",
    },
  });

  let totalArgs = 0;
  let migratedArgs = 0;

  for (const callNode of callNodes) {
    // Find array/tuple arguments inside the call
    const args = callNode.getMultipleMatches("ARGS");
    for (const arg of args) {
      if (!arg.isNamed() || arg.kind() === "comment") continue;
      totalArgs++;

      // Match tuple pattern: ["package-name", config]
      if (arg.kind() === "array") {
        const children = arg
          .children()
          .filter((c: SgNode) => c.isNamed() && c.kind() !== "comment");
        if (children.length >= 1) {
          const packageNameNode = children[0]!;
          const packageName = packageNameNode.text().replace(/^["']|["']$/g, "");
          const mapping = PLUGIN_MAP[packageName];

          if (mapping) {
            migratedArgs++;
            importsToAdd.set(mapping.importPath, mapping.functionName);
            // Build replacement: pluginFn(config) or pluginFn() if no config
            const configNodes = children.slice(1);
            const configText =
              configNodes.length > 0 ? configNodes.map((c: SgNode) => c.text()).join(", ") : "";
            const replacement = `${mapping.functionName}(${configText})`;
            edits.push(arg.replace(replacement));
          }
        }
      }
    }
  }

  // If any arguments could not be migrated, skip the entire transform to avoid
  // producing invalid code (e.g. mixing tuple syntax with plugin calls).
  if (totalArgs > 0 && migratedArgs < totalArgs) {
    return null;
  }

  // Step 2: Rename defineGenerators → definePlugins in call expressions only.
  // Import specifiers are handled separately in step 3 to avoid duplicates.
  const callIdentifiers = tree.findAll({
    rule: {
      pattern: "defineGenerators",
      kind: "identifier",
      inside: {
        kind: "call_expression",
      },
    },
  });

  for (const id of callIdentifiers) {
    edits.push(id.replace("definePlugins"));
  }

  // Step 3: Handle import specifier for defineGenerators.
  // If the import already contains definePlugins (mixed config), remove the
  // defineGenerators specifier instead of renaming it to avoid duplicates.
  const sdkImportStatements = tree.findAll({
    rule: {
      kind: "import_statement",
      has: {
        kind: "string",
        regex: "^[\"']@tailor-platform/sdk[\"']$",
      },
    },
  });

  // Check across ALL SDK import statements whether definePlugins is already
  // imported (may be in a different statement than defineGenerators).
  const sdkSpecifiers = sdkImportStatements.flatMap((stmt) =>
    stmt.findAll({ rule: { kind: "import_specifier" } }),
  );
  const legacyFactory = sdkSpecifiers
    .find((spec) => spec.field("name")?.text() === "defineGenerators" && !spec.field("alias"))
    ?.field("name");
  const pluginFactory = sdkSpecifiers.find(
    (spec) =>
      spec.field("name")?.text() === "definePlugins" &&
      (spec.field("alias") ?? spec.field("name"))?.text() === "definePlugins",
  );
  const pluginBinding = pluginFactory?.field("alias") ?? pluginFactory?.field("name");
  const hasDefinePlugins = pluginBinding !== undefined && pluginBinding !== null;
  if (
    !legacyFactory ||
    hasOtherBindingNamed(tree, "defineGenerators", legacyFactory.range().start.index) ||
    hasOtherBindingNamed(tree, "definePlugins", pluginBinding?.range().start.index ?? -1)
  ) {
    return null;
  }
  // Renaming the import is safe only when every factory reference is a direct
  // call covered by tuple conversion. Indirect references require manual review.
  for (const reference of tree.findAll({
    rule: {
      any: [{ kind: "identifier" }, { kind: "shorthand_property_identifier" }],
      regex: "^defineGenerators$",
    },
  })) {
    if (reference.parent()?.kind() === "import_specifier" || isIntrinsicJsxName(reference))
      continue;
    const parent = reference.parent();
    if (
      parent?.kind() !== "call_expression" ||
      parent.field("function")?.range().start.index !== reference.range().start.index
    ) {
      return null;
    }
  }

  // Calls through aliases are not covered by the tuple conversion above. Keep the
  // entire file intact so the legacy-pattern warning directs users to migrate it.
  if (
    sdkImportStatements.some((stmt) =>
      stmt
        .findAll({ rule: { kind: "import_specifier" } })
        .some((spec) => spec.field("name")?.text() === "defineGenerators" && spec.field("alias")),
    )
  ) {
    return null;
  }

  for (const importStmt of sdkImportStatements) {
    const specifiers = importStmt.findAll({
      rule: { kind: "import_specifier" },
    });

    for (const spec of specifiers) {
      const identNode = spec
        .children()
        .find((c: SgNode) => c.kind() === "identifier" && c.text() === "defineGenerators");
      if (!identNode) continue;

      if (hasDefinePlugins) {
        // Remove the entire specifier (including trailing/leading comma+whitespace)
        // by replacing the specifier text + any adjacent comma
        const specText = spec.text();
        const importText = importStmt.text();
        const idx = importText.indexOf(specText);
        if (idx !== -1) {
          // Check for trailing comma+whitespace or leading comma+whitespace
          const afterSpec = importText.slice(idx + specText.length);
          const beforeSpec = importText.slice(0, idx);
          let removeFrom = idx;
          let removeTo = idx + specText.length;

          if (afterSpec.match(/^\s*,/)) {
            removeTo = idx + specText.length + (afterSpec.match(/^\s*,\s*/)![0]?.length ?? 0);
          } else if (beforeSpec.match(/,\s*$/)) {
            removeFrom = idx - (beforeSpec.match(/,\s*$/)![0]?.length ?? 0);
          }

          const cleaned = importText.slice(0, removeFrom) + importText.slice(removeTo);
          edits.push(importStmt.replace(cleaned));
        }
      } else {
        edits.push(identNode.replace("definePlugins"));
      }
    }
  }

  // Step 4: Rename the export variable to `plugins`. Skip the whole file rather than
  // rename into a name that already means something else here.
  const declaratorsToRename: SgNode[] = [];
  const seenStarts = new Set<number>();
  for (const callNode of callNodes) {
    const declarator = findEnclosingDeclarator(callNode);
    if (!declarator) continue;
    const start = declarator.range().start.index;
    if (seenStarts.has(start)) continue;
    seenStarts.add(start);
    const nameNode = declarator.field("name");
    if (nameNode?.kind() === "identifier" && nameNode.text() !== "plugins") {
      declaratorsToRename.push(declarator);
    }
  }

  // Two (or more) defineGenerators()/definePlugins() outputs in one file can't all become
  // `plugins` without colliding; leave them all for a manual merge.
  if (declaratorsToRename.length === 1 && (!filePath || isTailorConfigPath(filePath))) {
    if (fileAlreadyBindsPlugins(tree)) {
      return null;
    }
    const nameNode = declaratorsToRename[0]!.field("name");
    if (nameNode) {
      const oldName = nameNode.text();
      if (!hasOtherBindingNamed(tree, oldName, nameNode.range().start.index)) {
        renameBindingAndUsages(tree, nameNode, oldName, edits);
      }
    }
  }

  if (edits.length === 0) {
    return null;
  }

  // Apply all edits
  let result = tree.commitEdits(edits);

  // Step 4: Add new import statements for plugin functions (skip already-present ones)
  if (importsToAdd.size > 0) {
    const importLines: string[] = [];
    for (const [importPath, functionName] of importsToAdd) {
      const line = `import { ${functionName} } from "${importPath}";`;
      // Skip if this function is already imported (mixed config scenario).
      // Use a targeted regex to match import statements containing the function
      // name, rather than checking the import path which could match unrelated
      // imports from the same module (e.g. importing a different symbol).
      const importExists = new RegExp(`import\\s*\\{[^}]*\\b${functionName}\\b[^}]*\\}`, "m").test(
        result,
      );
      if (importExists) continue;
      importLines.push(line);
    }
    // Sort for deterministic output and skip if all imports already present
    const sortedImportLines = importLines.toSorted();
    if (sortedImportLines.length === 0) {
      return result;
    }

    // Find insertion point: after the @tailor-platform/sdk import line
    const sdkImportRegex = /^(import\s+.*from\s+["']@tailor-platform\/sdk["'];?)$/m;
    const match = sdkImportRegex.exec(result);
    if (match) {
      const insertPos = (match.index ?? 0) + match[0].length;
      result =
        result.slice(0, insertPos) + "\n" + sortedImportLines.join("\n") + result.slice(insertPos);
    } else {
      // Fallback: prepend imports at the top of the file
      result = sortedImportLines.join("\n") + "\n" + result;
    }
  }

  return result;
}

export { reviewFindings } from "../../../../src/plugin-export-review";
