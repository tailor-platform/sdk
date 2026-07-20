import { Lang, parse } from "@ast-grep/napi";
import type { Edit, SgNode } from "@ast-grep/napi";

const PLUGIN_IMPORT =
  'import { tailordbErdPlugin } from "@tailor-platform/sdk-plugin-tailordb-erd";';
const DEFINE_PLUGINS_IMPORT = 'import { definePlugins } from "@tailor-platform/sdk";';
const SDK_VALUE_IMPORT_REGEX =
  /(^|\n)import\s*\{[^}\n]*\}\s*from\s*["']@tailor-platform\/sdk["'];?/;
const FUNCTION_KINDS = new Set([
  "arrow_function",
  "function_declaration",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "method_definition",
]);

function unquote(text: string): string {
  return text.replace(/^["']|["']$/g, "");
}

function propertyName(pair: SgNode): string | null {
  const key = pair.field("key");
  if (!key || key.kind() === "computed_property_name") return null;
  return unquote(key.text());
}

// A defineConfig() call inside a function may reference parameters or locals
// from its erdSite value; hoisting that expression to a module-level
// definePlugins() export would leave the binding out of scope.
function insideFunction(node: SgNode): boolean {
  for (let current = node.parent(); current; current = current.parent()) {
    if (FUNCTION_KINDS.has(current.kind() as string)) return true;
  }
  return false;
}

/**
 * Resolve the local binding name of `definePlugins` imported from
 * `@tailor-platform/sdk`, honoring `import { definePlugins as alias }`.
 * @param tree - Parsed source tree root.
 * @returns Local binding name, or null when it is not imported.
 */
function definePluginsLocalName(tree: SgNode): string | null {
  const importStatements = tree.findAll({
    rule: {
      kind: "import_statement",
      has: { kind: "string", regex: "^[\"']@tailor-platform/sdk[\"']$" },
    },
  });
  for (const statement of importStatements) {
    for (const specifier of statement.findAll({ rule: { kind: "import_specifier" } })) {
      const name = specifier.field("name");
      if (name?.text() !== "definePlugins") continue;
      return (specifier.field("alias") ?? name).text();
    }
  }
  return null;
}

/**
 * Build an edit that removes a property pair from an object literal, cleaning
 * up the separating comma and the removed line's indentation.
 * @param objectNode - Object literal containing the pair.
 * @param pairNode - Property pair to remove.
 * @returns Edit replacing the object literal with the pair removed.
 */
function removePairEdit(objectNode: SgNode, pairNode: SgNode): Edit {
  const objText = objectNode.text();
  const objStart = objectNode.range().start.index;
  const start = pairNode.range().start.index - objStart;
  const end = pairNode.range().end.index - objStart;
  const before = objText.slice(0, start);
  const after = objText.slice(end);

  let removeFrom = start;
  let removeTo = end;
  const trailing = after.match(/^[ \t]*,[ \t]*\n?/);
  if (trailing) {
    removeTo = end + trailing[0].length;
    const indent = before.match(/\n[ \t]*$/);
    if (indent) {
      // Keep the newline, drop the removed line's indentation.
      removeFrom = start - (indent[0].length - 1);
    }
  } else {
    const leading = before.match(/,\s*$/);
    if (leading) {
      removeFrom = start - leading[0].length;
    }
  }

  return objectNode.replace(objText.slice(0, removeFrom) + objText.slice(removeTo));
}

/**
 * Build an edit that appends an argument to a call expression, preserving the
 * call's single-line or multi-line formatting. Insertion points are derived
 * from argument-list AST nodes so a trailing line comment after the last
 * argument cannot swallow the separating comma.
 * @param callNode - Call expression to extend.
 * @param arg - Argument expression to append.
 * @returns Edit replacing the call expression with the argument appended.
 */
function appendArgEdit(callNode: SgNode, arg: string): Edit {
  const callText = callNode.text();
  const base = callNode.range().start.index;
  const argumentsNode = callNode.field("arguments")!;
  const children = argumentsNode.children();
  const args = children.filter((child) => child.isNamed() && child.kind() !== "comment");
  const closeParen = children.at(-1)!;
  const closeOffset = closeParen.range().start.index - base;
  const multiline = callText.includes("\n");
  const closeIndent = callText.slice(0, closeOffset).match(/\n([ \t]*)$/)?.[1] ?? "";
  const argIndent = `${closeIndent}  `;

  if (args.length === 0) {
    const head = callText.slice(0, closeOffset).replace(/[ \t]*$/, "");
    const rewritten = multiline ? `${head}${argIndent}${arg},\n${closeIndent})` : `${head}${arg})`;
    return callNode.replace(rewritten);
  }

  const lastArg = args.at(-1)!;
  const followers = children.slice(children.indexOf(lastArg) + 1);
  const trailingComma = followers.find((child) => !child.isNamed() && child.text() === ",");
  const insertAt = (trailingComma ?? lastArg).range().end.index - base;
  const separator = trailingComma ? "" : ",";
  const insertion = multiline ? `${separator}\n${argIndent}${arg},` : `${separator} ${arg}`;
  return callNode.replace(callText.slice(0, insertAt) + insertion + callText.slice(insertAt));
}

/**
 * Add `definePlugins` to an existing single-line value import from
 * `@tailor-platform/sdk`, or return null when no such import exists.
 * @param source - Source code to modify.
 * @returns Modified source, or null when a separate import line is needed.
 */
function addDefinePluginsSpecifier(source: string): string | null {
  const match = source.match(SDK_VALUE_IMPORT_REGEX);
  if (!match) return null;
  const updated = match[0].replace(/,?\s*\}/, ", definePlugins }");
  return source.replace(match[0], updated);
}

function insertImports(source: string, importLines: string[]): string {
  const sdkImportRegex = /^import\s+.*from\s+["']@tailor-platform\/sdk[^"']*["'];?$/gm;
  let lastMatch: RegExpExecArray | null = null;
  for (let match = sdkImportRegex.exec(source); match; match = sdkImportRegex.exec(source)) {
    lastMatch = match;
  }
  const block = importLines.join("\n");
  if (lastMatch) {
    const insertPos = lastMatch.index + lastMatch[0].length;
    return source.slice(0, insertPos) + "\n" + block + source.slice(insertPos);
  }
  return block + "\n" + source;
}

/**
 * Move `db.<namespace>.erdSite` entries in defineConfig() into a
 * `tailordbErdPlugin({ sites })` argument of definePlugins():
 *
 * 1. Remove each `erdSite` property from `db.<namespace>` objects of
 *    top-level defineConfig() calls (factory-wrapped configs are left for
 *    manual review, since their erdSite values may reference local bindings)
 * 2. Append `tailordbErdPlugin({ sites: { <namespace>: <value> } })` to the
 *    existing definePlugins() call (honoring an import alias), or add a
 *    `plugins` export when none exists
 * 3. Add the plugin import (and a definePlugins import when newly needed)
 * @param source - Source code to transform
 * @returns Transformed source or null if no changes needed
 */
export default function transform(source: string): string | null {
  if (!source.includes("erdSite") || !source.includes("@tailor-platform/sdk")) {
    return null;
  }
  // Already migrated (or partially migrated) configs need manual review.
  if (source.includes("tailordbErdPlugin")) {
    return null;
  }

  const tree = parse(Lang.TypeScript, source).root();
  const edits: Edit[] = [];
  const siteEntries: string[] = [];

  for (const call of tree.findAll({ rule: { pattern: "defineConfig($CONFIG)" } })) {
    if (insideFunction(call)) continue;
    const config = call.getMatch("CONFIG");
    if (!config || config.kind() !== "object") continue;

    const dbPair = config
      .children()
      .find((child) => child.kind() === "pair" && propertyName(child) === "db");
    const dbObject = dbPair?.field("value");
    if (!dbObject || dbObject.kind() !== "object") continue;

    for (const nsPair of dbObject.children().filter((child) => child.kind() === "pair")) {
      const nsKey = nsPair.field("key");
      const nsObject = nsPair.field("value");
      if (!nsKey || nsKey.kind() === "computed_property_name") continue;
      if (!nsObject || nsObject.kind() !== "object") continue;

      const erdPair = nsObject
        .children()
        .find((child) => child.kind() === "pair" && propertyName(child) === "erdSite");
      const valueNode = erdPair?.field("value");
      if (!erdPair || !valueNode) continue;

      siteEntries.push(`${nsKey.text()}: ${valueNode.text()}`);
      edits.push(removePairEdit(nsObject, erdPair));
    }
  }

  if (siteEntries.length === 0) {
    return null;
  }

  const pluginExpr = `tailordbErdPlugin({ sites: { ${siteEntries.join(", ")} } })`;
  const localDefinePlugins = definePluginsLocalName(tree);
  const pluginsCall = tree.find({
    rule: { pattern: `${localDefinePlugins ?? "definePlugins"}($$$ARGS)` },
  });
  if (pluginsCall) {
    edits.push(appendArgEdit(pluginsCall, pluginExpr));
  }

  let result = tree.commitEdits(edits);

  const importLines = [PLUGIN_IMPORT];
  if (!pluginsCall && !localDefinePlugins) {
    const merged = addDefinePluginsSpecifier(result);
    if (merged !== null) {
      result = merged;
    } else {
      importLines.push(DEFINE_PLUGINS_IMPORT);
    }
  }
  result = insertImports(result, importLines);

  if (!pluginsCall) {
    result =
      result.replace(/\s*$/, "\n\n") +
      `export const plugins = ${localDefinePlugins ?? "definePlugins"}(\n  ${pluginExpr},\n);\n`;
  }

  return result;
}
