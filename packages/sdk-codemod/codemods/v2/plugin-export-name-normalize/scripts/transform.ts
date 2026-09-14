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
 * Whether the file already binds the name `plugins`, as a top-level variable or an
 * imported (possibly aliased) specifier. Used to avoid a rename that would collide.
 * @param root - File root node
 * @returns True if a `plugins` binding already exists
 */
function fileAlreadyBindsPlugins(root: SgNode): boolean {
  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const nameNode = decl.field("name");
    if (nameNode?.kind() === "identifier" && nameNode.text() === "plugins") return true;
  }
  for (const spec of root.findAll({ rule: { kind: "import_specifier" } })) {
    const local = spec.field("alias") ?? spec.field("name");
    if (local?.text() === "plugins") return true;
  }
  return false;
}

/**
 * Whether some other declaration in the file already binds `name` (excluding the node at
 * `excludeStart`). Used to avoid renaming bare identifier usages into a binding that a
 * shadowing declaration elsewhere in the file also uses, which a plain text-match rename
 * cannot tell apart from the reference being renamed.
 * @param root - File root node
 * @param name - Binding name to look for
 * @param excludeStart - Byte offset of the node to ignore (the specifier being renamed)
 * @returns True when another declaration for `name` exists
 */
function hasOtherBindingNamed(root: SgNode, name: string, excludeStart: number): boolean {
  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const nameNode = decl.field("name");
    if (nameNode?.kind() === "identifier" && nameNode.text() === name) return true;
  }
  for (const fn of root.findAll({ rule: { kind: "function_declaration" } })) {
    if (fn.field("name")?.text() === name) return true;
  }
  for (const cls of root.findAll({ rule: { kind: "class_declaration" } })) {
    if (cls.field("name")?.text() === name) return true;
  }
  for (const spec of root.findAll({ rule: { kind: "import_specifier" } })) {
    if (spec.range().start.index === excludeStart) continue;
    const local = spec.field("alias") ?? spec.field("name");
    if (local?.text() === name) return true;
  }
  return false;
}

/**
 * Normalize the plugin config export name to `plugins`:
 *
 * 1. `export const generator|generators = definePlugins(...)` → `export const plugins = ...`
 * 2. `import { generator|generators [as alias] } from ".../tailor.config"` → renamed to
 *    `plugins` (keeping any existing alias), with bare local usages renamed to match when
 *    there was no alias.
 *
 * The whole file is left untouched when it already binds `plugins` to something else, or
 * when a bare (unaliased) import's local usages cannot be told apart from an unrelated
 * same-named binding elsewhere in the file.
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
    if (nameNode) edits.push(nameNode.replace("plugins"));
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
    if (hasOtherBindingNamed(tree, oldName, importedNode.range().start.index)) {
      continue;
    }

    edits.push(importedNode.replace("plugins"));
    for (const idNode of tree.findAll({
      rule: {
        any: [
          { kind: "identifier", regex: `^${oldName}$` },
          { kind: "shorthand_property_identifier", regex: `^${oldName}$` },
        ],
      },
    })) {
      if (idNode.range().start.index === importedNode.range().start.index) continue;
      edits.push(idNode.replace("plugins"));
    }
  }

  if (edits.length === 0) return null;

  return tree.commitEdits(edits);
}
