import * as fs from "node:fs";
import { type SgNode, type SgRoot, Lang, parse } from "@ast-grep/napi";

export type { SgNode, SgRoot };
export { Lang };

/**
 * Parse a TypeScript or TSX source string into an ast-grep root node.
 * @param source - TypeScript source code string
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Parsed ast-grep root node
 */
export function parseTypeScript(source: string, lang: Lang = Lang.TypeScript): SgRoot {
  return parse(lang, source);
}

/**
 * Determine the ast-grep language for a file path.
 * @param filePath - File path to check
 * @returns Lang.Tsx for .tsx files, Lang.TypeScript otherwise
 */
export function langForFile(filePath: string): Lang {
  return filePath.endsWith(".tsx") ? Lang.Tsx : Lang.TypeScript;
}

/**
 * Find all matches of a pattern in source code.
 * @param source - Source code to search
 * @param pattern - ast-grep pattern to match
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Array of matched nodes
 */
export function findPattern(
  source: string,
  pattern: string,
  lang: Lang = Lang.TypeScript,
): SgNode[] {
  const root = parseTypeScript(source, lang);
  return root.root().findAll(pattern);
}

/**
 * Extract argument nodes from a variadic capture, filtering out comma separators.
 *
 * `$$$ARGS` captures include comma separator nodes in the AST. This helper
 * filters them so you get only the actual argument nodes.
 * @param node - The matched AST node containing the capture
 * @param name - The capture name (e.g., "ARGS")
 * @returns Array of argument nodes without commas
 */
export function getArgs(node: SgNode, name: string): SgNode[] {
  return node.getMultipleMatches(name).filter((n) => n.kind() !== ",");
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find all identifier-like nodes matching a name in source code.
 *
 * Unlike `findPattern`, this matches both `identifier` and `property_identifier`
 * AST nodes. This is necessary because object property keys (e.g., `publishEvents`
 * in `{ publishEvents: true }`) are `property_identifier` nodes that `findPattern`
 * does not match.
 * @param source - Source code to search
 * @param name - Exact identifier name to match
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Array of matched nodes (both identifiers and property identifiers)
 */
export function findIdentifiers(
  source: string,
  name: string,
  lang: Lang = Lang.TypeScript,
): SgNode[] {
  const root = parseTypeScript(source, lang);
  const escapedName = escapeRegExp(name);
  // Match identifier, property_identifier, and shorthand_property_identifier nodes.
  // Shorthand properties like `{ oldName }` use a distinct AST node kind.
  return root.root().findAll({
    rule: {
      any: [
        { kind: "identifier", regex: `^${escapedName}$` },
        { kind: "property_identifier", regex: `^${escapedName}$` },
        { kind: "shorthand_property_identifier", regex: `^${escapedName}$` },
      ],
    },
  } as Parameters<SgNode["findAll"]>[0]);
}

/**
 * Rename all occurrences of an identifier in source code.
 *
 * Uses `findIdentifiers` for AST-aware detection (matches both `identifier` and
 * `property_identifier` nodes), then `replaceAll` for replacement. The `replaceAll`
 * step intentionally also renames occurrences in comments and string literals, which
 * is desirable for migration (keeping docs/comments up to date).
 * @param source - Source code to transform
 * @param oldName - Current identifier name
 * @param newName - New identifier name
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source and count of AST matches found
 */
export function renameIdentifiers(
  source: string,
  oldName: string,
  newName: string,
  lang: Lang = Lang.TypeScript,
): { output: string; count: number } {
  const matches = findIdentifiers(source, oldName, lang);
  if (matches.length === 0) return { output: source, count: 0 };
  // Use word-boundary regex instead of replaceAll to avoid corrupting longer
  // identifiers that contain the renamed name as a substring.
  const pattern = new RegExp(`\\b${escapeRegExp(oldName)}\\b`, "g");
  return { output: source.replace(pattern, () => newName), count: matches.length };
}

/**
 * Rename multiple identifiers in a single pass over the source.
 *
 * Automatically sorts renames by key length (longest first) to prevent substring
 * conflicts. For example, `createWorkflowJob` is processed before `createWorkflow`
 * so the shorter name doesn't corrupt the longer one.
 *
 * **Limitation**: Renames are applied sequentially, so overlapping rename sets where
 * a new name equals another old name (e.g., `{ foo -> bar, bar -> baz }`) will
 * cascade incorrectly. Ensure rename maps do not have such overlaps.
 *
 * Uses `findIdentifiers` for detection, so `identifier`, `property_identifier`,
 * and `shorthand_property_identifier` nodes are matched.
 * @param source - Source code to transform
 * @param renames - Map of old names to new names
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source and total count of AST matches found
 */
export function batchRename(
  source: string,
  renames: ReadonlyMap<string, string>,
  lang: Lang = Lang.TypeScript,
): { output: string; count: number } {
  // Sort by key length descending to prevent substring conflicts with replaceAll
  const sorted = [...renames.entries()].sort((a, b) => b[0].length - a[0].length);

  let result = source;
  let totalCount = 0;

  for (const [oldName, newName] of sorted) {
    const { output, count } = renameIdentifiers(result, oldName, newName, lang);
    if (count > 0) {
      result = output;
      totalCount += count;
    }
  }

  return { output: result, count: totalCount };
}

interface TextEdit {
  startIndex: number;
  endIndex: number;
  newText: string;
}

/**
 * Apply text edits to a source string in reverse order to preserve character offsets.
 * @param source - Source string to apply edits to
 * @param edits - Text edits sorted by position
 * @returns Source string with all edits applied
 */
function applyEdits(source: string, edits: readonly TextEdit[]): string {
  let output = source;
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i];
    output = output.slice(0, edit.startIndex) + edit.newText + output.slice(edit.endIndex);
  }
  return output;
}

/**
 * Apply a pattern-based replacement to source code.
 *
 * Uses ast-grep to find matches and applies a replacer function that receives
 * the matched node and returns the replacement text. This approach is more
 * reliable than template-based replacement since ast-grep's Node API
 * does not expand metavariables in replace templates.
 * @param source - Original source code
 * @param pattern - ast-grep pattern to match
 * @param replacer - Function that takes a matched node and returns replacement text
 * @param lang - Language to parse as (defaults to TypeScript; use Lang.Tsx for .tsx files)
 * @returns Object with the new source and count of replacements made
 */
export function applyPatternReplace(
  source: string,
  pattern: string,
  replacer: (node: SgNode) => string,
  lang?: Lang,
): { output: string; count: number } {
  const root = parseTypeScript(source, lang);
  const matches = root.root().findAll(pattern);
  if (matches.length === 0) {
    return { output: source, count: 0 };
  }

  // Build edits from matches, keeping only outermost when matches are nested
  // (e.g., foo(foo(1)) produces both outer and inner matches).
  const allEdits: TextEdit[] = matches
    .map((match) => {
      const range = match.range();
      return {
        startIndex: range.start.index,
        endIndex: range.end.index,
        newText: replacer(match),
      };
    })
    .sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);

  // Forward pass: keep only non-overlapping outermost matches
  const edits: TextEdit[] = [];
  let lastEnd = -1;
  for (const edit of allEdits) {
    if (edit.startIndex >= lastEnd) {
      edits.push(edit);
      lastEnd = edit.endIndex;
    }
  }

  return { output: applyEdits(source, edits), count: edits.length };
}

export interface TransformFileResult {
  changed: boolean;
  before?: string;
  after?: string;
}

/**
 * Read a file, apply a transform function, and optionally write back.
 *
 * In dry-run mode, the `before` and `after` fields are populated for diff display.
 * @param filePath - Path to the file to transform
 * @param transform - Function that takes source and returns transformed source (or null if no change)
 * @param dryRun - If true, do not write the file
 * @param sourceOverride - Pre-loaded source content (from a previous rule's dry-run output)
 * @returns Result with changed flag and optional before/after content (dry-run only)
 */
export async function transformFile(
  filePath: string,
  transform: (source: string) => string | null,
  dryRun: boolean,
  sourceOverride?: string,
): Promise<TransformFileResult> {
  const source = sourceOverride ?? (await fs.promises.readFile(filePath, "utf-8"));
  const result = transform(source);
  if (result === null || result === source) {
    return { changed: false };
  }
  if (!dryRun) {
    await fs.promises.writeFile(filePath, result, "utf-8");
  }
  return {
    changed: true,
    before: dryRun ? source : undefined,
    after: dryRun ? result : undefined,
  };
}

// ---------------------------------------------------------------------------
// Import manipulation helpers
// ---------------------------------------------------------------------------

/**
 * Find import_statement nodes, optionally filtered by module specifier.
 * @param source - Source code to parse
 * @param moduleSpecifier - Module specifier to filter by (e.g., "mod"). If undefined, returns all imports.
 * @param lang - Language to parse as
 * @returns Parsed root and matching import nodes
 */
function findImportStatements(
  source: string,
  moduleSpecifier: string | undefined,
  lang: Lang,
): { root: SgRoot; imports: SgNode[] } {
  const root = parseTypeScript(source, lang);
  const imports = root
    .root()
    .findAll({ rule: { kind: "import_statement" } } as Parameters<SgNode["findAll"]>[0]);

  if (moduleSpecifier === undefined) {
    return { root, imports };
  }

  const filtered = imports.filter((node) => {
    const stringNode = node.children().find((c) => c.kind() === "string");
    if (!stringNode) return false;
    const fragment = stringNode.children().find((c) => c.kind() === "string_fragment");
    return fragment?.text() === moduleSpecifier;
  });

  return { root, imports: filtered };
}

/**
 * Rename a named import specifier within import statements.
 *
 * Only affects identifiers inside import statements, not usage in the code body.
 * @param source - Source code to transform
 * @param oldName - Current import specifier name
 * @param newName - New import specifier name
 * @param moduleSpecifier - Optional module specifier to filter by
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source and count of renames made
 */
export function renameImportSpecifier(
  source: string,
  oldName: string,
  newName: string,
  moduleSpecifier?: string,
  lang: Lang = Lang.TypeScript,
): { output: string; count: number } {
  const { imports } = findImportStatements(source, moduleSpecifier, lang);

  const edits: TextEdit[] = [];

  for (const imp of imports) {
    const specifiers = imp.findAll({
      rule: { kind: "import_specifier" },
    } as Parameters<SgNode["findAll"]>[0]);

    for (const spec of specifiers) {
      const ident = spec.children().find((c) => c.kind() === "identifier" && c.text() === oldName);
      if (ident) {
        const range = ident.range();
        edits.push({
          startIndex: range.start.index,
          endIndex: range.end.index,
          newText: newName,
        });
      }
    }
  }

  if (edits.length === 0) return { output: source, count: 0 };

  return { output: applyEdits(source, edits), count: edits.length };
}

/**
 * Remove a named import specifier from import statements.
 *
 * If it is the last specifier in the import, the entire import statement is removed.
 * @param source - Source code to transform
 * @param specifierName - Import specifier name to remove
 * @param moduleSpecifier - Optional module specifier to filter by
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source and count of specifiers removed
 */
export function removeImportSpecifier(
  source: string,
  specifierName: string,
  moduleSpecifier?: string,
  lang: Lang = Lang.TypeScript,
): { output: string; count: number } {
  const { imports } = findImportStatements(source, moduleSpecifier, lang);

  const edits: TextEdit[] = [];

  for (const imp of imports) {
    const specifiers = imp.findAll({
      rule: { kind: "import_specifier" },
    } as Parameters<SgNode["findAll"]>[0]);

    const targetIdx = specifiers.findIndex((spec) => {
      const ident = spec.children().find((c) => c.kind() === "identifier");
      return ident?.text() === specifierName;
    });

    if (targetIdx === -1) continue;

    if (specifiers.length === 1) {
      // Remove the entire import statement (including trailing newline)
      const impRange = imp.range();
      let endIdx = impRange.end.index;
      if (source[endIdx] === "\n") {
        endIdx += 1;
      }
      edits.push({
        startIndex: impRange.start.index,
        endIndex: endIdx,
        newText: "",
      });
    } else {
      const target = specifiers[targetIdx];
      const targetRange = target.range();

      if (targetIdx === 0) {
        // First specifier: remove from its start to the next specifier's start
        const next = specifiers[targetIdx + 1];
        const nextRange = next.range();
        edits.push({
          startIndex: targetRange.start.index,
          endIndex: nextRange.start.index,
          newText: "",
        });
      } else {
        // Non-first specifier: remove from previous specifier's end to this specifier's end
        const prev = specifiers[targetIdx - 1];
        const prevRange = prev.range();
        edits.push({
          startIndex: prevRange.end.index,
          endIndex: targetRange.end.index,
          newText: "",
        });
      }
    }
  }

  if (edits.length === 0) return { output: source, count: 0 };

  return { output: applyEdits(source, edits), count: edits.length };
}

/**
 * Add a named import specifier to an existing import, or create a new import statement.
 *
 * If a matching import already has the specifier, returns unchanged with count 0.
 * @param source - Source code to transform
 * @param specifierName - Import specifier name to add
 * @param moduleSpecifier - Module specifier for the import
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source and count (0 if duplicate, 1 if added)
 */
export function addImportSpecifier(
  source: string,
  specifierName: string,
  moduleSpecifier: string,
  lang: Lang = Lang.TypeScript,
): { output: string; count: number } {
  const root = parseTypeScript(source, lang);
  const allImports = root
    .root()
    .findAll({ rule: { kind: "import_statement" } } as Parameters<SgNode["findAll"]>[0]);

  // Find import matching the module specifier
  const matchingImport = allImports.find((node) => {
    const stringNode = node.children().find((c) => c.kind() === "string");
    if (!stringNode) return false;
    const fragment = stringNode.children().find((c) => c.kind() === "string_fragment");
    return fragment?.text() === moduleSpecifier;
  });

  if (matchingImport) {
    // Check for named_imports
    const namedImports = matchingImport
      .children()
      .flatMap((c) => (c.kind() === "import_clause" ? c.children() : []))
      .find((c) => c.kind() === "named_imports");

    if (namedImports) {
      // Check for duplicate
      const specifiers = namedImports.findAll({
        rule: { kind: "import_specifier" },
      } as Parameters<SgNode["findAll"]>[0]);

      const hasDuplicate = specifiers.some((spec) => {
        const ident = spec.children().find((c) => c.kind() === "identifier");
        return ident?.text() === specifierName;
      });

      if (hasDuplicate) return { output: source, count: 0 };

      // Insert after the last specifier
      const lastSpec = specifiers[specifiers.length - 1];
      const closeBrace = namedImports.children().find((c) => c.kind() === "}" && c.text() === "}");
      if (lastSpec && closeBrace) {
        const lastSpecEnd = lastSpec.range().end.index;
        const braceRange = closeBrace.range();
        const newText = `, ${specifierName} }`;
        const output = source.slice(0, lastSpecEnd) + newText + source.slice(braceRange.end.index);
        return { output, count: 1 };
      }
    }
  }

  // No matching import found - create new import
  const newImportLine = `import { ${specifierName} } from "${moduleSpecifier}";\n`;

  if (allImports.length > 0) {
    // Insert after the last import statement
    const lastImport = allImports[allImports.length - 1];
    const lastRange = lastImport.range();
    let insertIdx = lastRange.end.index;
    // Skip past trailing newline of the last import
    if (source[insertIdx] === "\n") {
      insertIdx += 1;
    }
    const output = source.slice(0, insertIdx) + newImportLine + source.slice(insertIdx);
    return { output, count: 1 };
  }

  // No imports at all - insert at beginning
  const output = newImportLine + source;
  return { output, count: 1 };
}

// ---------------------------------------------------------------------------
// Context-limited property rename
// ---------------------------------------------------------------------------

/**
 * Rename identifiers only within AST matches of a pattern.
 *
 * Scopes the rename to matching contexts only, preventing false positives
 * from a global rename.
 * @param source - Source code to transform
 * @param pattern - ast-grep pattern to match
 * @param oldProp - Current property/identifier name
 * @param newProp - New property/identifier name
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source and count of pattern matches where replacement occurred
 */
export function renamePropertyInPattern(
  source: string,
  pattern: string,
  oldProp: string,
  newProp: string,
  lang: Lang = Lang.TypeScript,
): { output: string; count: number } {
  return applyPatternReplace(
    source,
    pattern,
    (node) => {
      const text = node.text();
      const { output, count } = renameIdentifiers(text, oldProp, newProp, lang);
      return count > 0 ? output : text;
    },
    lang,
  );
}

// ---------------------------------------------------------------------------
// Structural change helpers
//
// These helpers (removeProperty, addProperty, replacePropertyValue, etc.)
// operate on the first (outermost) object within the pattern match. This is
// by design for SDK migration patterns where function calls take a single
// config object argument. For patterns with multiple object arguments (e.g.,
// `setup({ a: 1 }, { b: 2 })`), use applyPatternReplace with a custom
// replacer that targets the correct argument via getArgs/getMultipleMatches.
// ---------------------------------------------------------------------------

/**
 * Find the first (outermost) object node in parsed source.
 * @param root - Parsed ast-grep root
 * @returns The first object node, or undefined if none found
 */
function findOutermostObject(root: SgRoot): SgNode | undefined {
  const objects = root
    .root()
    .findAll({ rule: { kind: "object" } } as Parameters<SgNode["findAll"]>[0]);
  return objects[0];
}

/**
 * Find a direct-child pair whose key matches the given property name.
 * @param obj - Object AST node to search
 * @param propertyName - Property name to match
 * @returns The matching pair node, or undefined if not found
 */
function findDirectPair(obj: SgNode, propertyName: string): SgNode | undefined {
  return obj
    .children()
    .filter((c) => c.kind() === "pair")
    .find((pair) => {
      const key = pair.children().find((c) => c.kind() === "property_identifier");
      return key?.text() === propertyName;
    });
}

/**
 * Remove a property (key-value pair) from objects within pattern matches.
 * @param source - Source code to transform
 * @param objectPattern - ast-grep pattern to match (e.g., "setup($$$ARGS)")
 * @param propertyName - Property name to remove
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source and count of pattern matches processed
 */
export function removeProperty(
  source: string,
  objectPattern: string,
  propertyName: string,
  lang: Lang = Lang.TypeScript,
): { output: string; count: number } {
  return applyPatternReplace(
    source,
    objectPattern,
    (node) => {
      const text = node.text();
      const innerRoot = parseTypeScript(text, lang);
      const obj = findOutermostObject(innerRoot);
      if (!obj) return text;

      const matchingPair = findDirectPair(obj, propertyName);
      if (!matchingPair) return text;

      const allProperties = obj.children().filter((c) => {
        const k = c.kind();
        return k === "pair" || k === "shorthand_property_identifier" || k === "spread_element";
      });
      if (allProperties.length === 1) {
        // Only the target pair in this object - replace entire object with empty `{}`
        const objRange = obj.range();
        return text.slice(0, objRange.start.index) + "{}" + text.slice(objRange.end.index);
      }

      const pairRange = matchingPair.range();
      let startIdx = pairRange.start.index;
      let endIdx = pairRange.end.index;

      // Check for trailing comma and whitespace
      const afterPair = text.substring(endIdx);
      const trailingMatch = afterPair.match(/^,\s*/);
      if (trailingMatch) {
        endIdx += trailingMatch[0].length;
      } else {
        // No trailing comma - check for leading comma and whitespace
        const beforePair = text.substring(0, startIdx);
        const leadingMatch = beforePair.match(/,\s*$/);
        if (leadingMatch) {
          startIdx -= leadingMatch[0].length;
        }
      }

      return text.slice(0, startIdx) + text.slice(endIdx);
    },
    lang,
  );
}

/**
 * Add a property to objects within pattern matches.
 *
 * Does not add if the property already exists in the object.
 * @param source - Source code to transform
 * @param objectPattern - ast-grep pattern to match (e.g., "setup($$$ARGS)")
 * @param propertyName - Property name to add
 * @param propertyValue - Property value as a source string
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source and count of pattern matches processed
 */
export function addProperty(
  source: string,
  objectPattern: string,
  propertyName: string,
  propertyValue: string,
  lang: Lang = Lang.TypeScript,
): { output: string; count: number } {
  return applyPatternReplace(
    source,
    objectPattern,
    (node) => {
      const text = node.text();
      const innerRoot = parseTypeScript(text, lang);
      const obj = findOutermostObject(innerRoot);
      if (!obj) return text;

      const objRange = obj.range();
      const objText = obj.text();

      // Check if property already exists in direct children (not nested objects).
      // Check both pair nodes (key: value) and shorthand properties ({ key }).
      const pairExists = !!findDirectPair(obj, propertyName);
      const shorthandExists = obj
        .children()
        .filter((c) => c.kind() === "shorthand_property_identifier")
        .some((c) => c.text() === propertyName);
      if (pairExists || shorthandExists) return text;

      const newProp = `${propertyName}: ${propertyValue}`;
      const closeBraceIdx = objText.lastIndexOf("}");
      if (closeBraceIdx === -1) return text;

      const beforeClose = objText.substring(0, closeBraceIdx);
      const trimmedBefore = beforeClose.trimEnd();

      let modified: string;
      if (trimmedBefore === "{") {
        // Empty object: `{}` -> `{ prop: val }`
        modified = `{ ${newProp} }`;
      } else if (trimmedBefore.match(/\/\/[^\n]*$/)) {
        // Last line ends with a // comment: add new property on a new line
        // to avoid commenting it out.
        const indent = objText.match(/\n(\s*)\S/)?.[1] ?? "  ";
        const hasTrailingComma = trimmedBefore
          .replace(/\/\/[^\n]*$/, "")
          .trimEnd()
          .endsWith(",");
        const comma = hasTrailingComma ? "" : ",";
        modified = trimmedBefore + comma + "\n" + indent + newProp + "\n}";
      } else {
        // Non-empty: add after last content with comma
        const hasTrailingComma = trimmedBefore.endsWith(",");
        const separator = hasTrailingComma ? " " : ", ";
        modified = trimmedBefore + separator + newProp + " }";
      }

      return text.slice(0, objRange.start.index) + modified + text.slice(objRange.end.index);
    },
    lang,
  );
}

/**
 * Wrap expressions that match a pattern with a template string.
 *
 * The template uses `$EXPR` as a placeholder for the matched expression text.
 * @param source - Source code to transform
 * @param pattern - ast-grep pattern to match
 * @param wrapperTemplate - Template string with `$EXPR` placeholder
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source and count of wraps applied
 */
export function wrapExpression(
  source: string,
  pattern: string,
  wrapperTemplate: string,
  lang: Lang = Lang.TypeScript,
): { output: string; count: number } {
  return applyPatternReplace(
    source,
    pattern,
    (node) => wrapperTemplate.replaceAll("$EXPR", node.text()),
    lang,
  );
}

// ---------------------------------------------------------------------------
// Property value replacement
// ---------------------------------------------------------------------------

/**
 * Replace the value of a specific property within objects matching a pattern.
 *
 * Finds objects matching the pattern, locates the named property, and applies
 * the replacer function to its value node. Useful for migrating property values
 * without changing the property name.
 * @param source - Source code to transform
 * @param objectPattern - ast-grep pattern to match (e.g., "config($$$ARGS)")
 * @param propertyName - Property name whose value should be replaced
 * @param replacer - Function that takes the value node and returns replacement text
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source and count of pattern matches processed
 */
export function replacePropertyValue(
  source: string,
  objectPattern: string,
  propertyName: string,
  replacer: (valueNode: SgNode) => string,
  lang: Lang = Lang.TypeScript,
): { output: string; count: number } {
  return applyPatternReplace(
    source,
    objectPattern,
    (node) => {
      const text = node.text();
      const innerRoot = parseTypeScript(text, lang);
      const obj = findOutermostObject(innerRoot);
      if (!obj) return text;

      const matchingPair = findDirectPair(obj, propertyName);
      if (!matchingPair) return text;

      // The value is the last meaningful child of the pair (after the key and colon)
      const children = matchingPair.children();
      const valueNode = children[children.length - 1];
      if (!valueNode) return text;

      const newValue = replacer(valueNode);
      const valueRange = valueNode.range();
      return text.slice(0, valueRange.start.index) + newValue + text.slice(valueRange.end.index);
    },
    lang,
  );
}

// ---------------------------------------------------------------------------
// Function call argument transformation
// ---------------------------------------------------------------------------

/**
 * Transform the arguments of function calls matching a name pattern.
 *
 * Matches calls like `functionName(args...)` and passes the argument nodes
 * (with comma separators filtered out) to a transformer function that returns
 * the new argument string. The function name itself is preserved; use
 * `renameIdentifiers` separately to change it.
 * @param source - Source code to transform
 * @param functionName - Function name pattern to match (e.g., "defineGenerators" or "$OBJ.method")
 * @param transformer - Function that receives argument nodes and returns new arguments string
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source and count of calls transformed
 */
export function transformCallArguments(
  source: string,
  functionName: string,
  transformer: (args: SgNode[]) => string,
  lang: Lang = Lang.TypeScript,
): { output: string; count: number } {
  const pattern = `${functionName}($$$ARGS)`;
  return applyPatternReplace(
    source,
    pattern,
    (node) => {
      const args = getArgs(node, "ARGS");
      const newArgs = transformer(args);
      // Reconstruct the call from the AST arguments node so receiver expressions
      // like `getObj().method(...)` are preserved correctly.
      const fullText = node.text();
      const argsNode = node.children().find((child) => child.kind() === "arguments");
      const fnPart = argsNode
        ? fullText.slice(0, argsNode.range().start.index - node.range().start.index)
        : fullText;
      return `${fnPart}(${newArgs})`;
    },
    lang,
  );
}

// ---------------------------------------------------------------------------
// Nested property path rename
// ---------------------------------------------------------------------------

/**
 * Rename a property at a specific nested path within objects matching a pattern.
 *
 * Navigates through nested object levels following the dot-separated path,
 * then renames only the target property at that exact location. Properties
 * with the same name at other nesting levels are not affected.
 * @param source - Source code to transform
 * @param rootPattern - ast-grep pattern to match (e.g., "config($$$ARGS)")
 * @param propertyPath - Dot-separated path to navigate (e.g., "userProfile.attributes"). Empty string for root level.
 * @param oldName - Current property name to rename
 * @param newName - New property name
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source and count of pattern matches processed
 */
export function renamePropertyAtPath(
  source: string,
  rootPattern: string,
  propertyPath: string,
  oldName: string,
  newName: string,
  lang: Lang = Lang.TypeScript,
): { output: string; count: number } {
  return applyPatternReplace(
    source,
    rootPattern,
    (node) => {
      const text = node.text();
      const innerRoot = parseTypeScript(text, lang);
      const segments = propertyPath === "" ? [] : propertyPath.split(".");

      let targetObject = findOutermostObject(innerRoot);
      if (!targetObject) return text;

      // Navigate through path segments
      for (const segment of segments) {
        const matchingPair = findDirectPair(targetObject, segment);
        if (!matchingPair) return text; // Path not found

        // Find the nested object value
        const nestedObj = matchingPair.children().find((c) => c.kind() === "object");
        if (!nestedObj) return text; // Value is not an object

        targetObject = nestedObj;
      }

      // At the target level, find and rename the property
      const targetPair = findDirectPair(targetObject, oldName);
      if (!targetPair) return text;

      const key = targetPair.children().find((c) => c.kind() === "property_identifier");
      if (!key) return text;

      const keyRange = key.range();
      return text.slice(0, keyRange.start.index) + newName + text.slice(keyRange.end.index);
    },
    lang,
  );
}

// ---------------------------------------------------------------------------
// Property access rename (dot and optional chain)
// ---------------------------------------------------------------------------

/**
 * Rename a property in member access expressions, handling both `.` and `?.` access.
 *
 * Matches `receiverPattern.oldProp` and `receiverPattern?.oldProp` patterns and
 * renames only the property identifier. This is useful for renaming properties in
 * access chains like `context.user.attributes` without affecting unrelated identifiers.
 * @param source - Source code to transform
 * @param receiverPattern - ast-grep pattern for the object receiver (e.g., "$A.user" or "$A")
 * @param oldProp - Current property name to rename
 * @param newProp - New property name
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source and count of renames made
 */
export function renamePropertyAccess(
  source: string,
  receiverPattern: string,
  oldProp: string,
  newProp: string,
  lang: Lang = Lang.TypeScript,
): { output: string; count: number } {
  const replacer = (node: SgNode): string => {
    const text = node.text();
    // The property name is at the very end of the member expression text
    if (text.endsWith(oldProp)) {
      return text.slice(0, text.length - oldProp.length) + newProp;
    }
    return text;
  };

  // Match regular dot access: receiver.oldProp
  const dotResult = applyPatternReplace(source, `${receiverPattern}.${oldProp}`, replacer, lang);

  // Match optional chain access: receiver?.oldProp
  const chainResult = applyPatternReplace(
    dotResult.output,
    `${receiverPattern}?.${oldProp}`,
    replacer,
    lang,
  );

  return {
    output: chainResult.output,
    count: dotResult.count + chainResult.count,
  };
}

// ---------------------------------------------------------------------------
// Tuple-to-call argument transformation
// ---------------------------------------------------------------------------

/**
 * Mapping entry for transforming a tuple argument into a function call.
 */
export interface TupleToCallMapping {
  /** Package name string in the tuple (e.g., "@tailor-platform/kysely-type") */
  packageName: string;
  /** Function name to call (e.g., "kyselyTypePlugin") */
  functionName: string;
  /** Import path for the function (e.g., "@tailor-platform/sdk/plugin/kysely-type") */
  importPath: string;
}

/**
 * Transform tuple arguments in function calls to individual function calls using a mapping table.
 *
 * Converts patterns like `callName(["pkg-name", config])` to `callName(fnName(config))`.
 * Each tuple's first element (string literal) is looked up in the mappings. If found, the
 * tuple is replaced with a function call. Unknown packages and non-array arguments are
 * preserved as-is.
 *
 * The `imports` field in the return value lists which functions were used, so the caller
 * can add the necessary import statements via `addImportSpecifier`.
 * @param source - Source code to transform
 * @param callName - Function name pattern to match (e.g., "defineGenerators")
 * @param mappings - Array of package-to-function mappings
 * @param lang - Language to parse as (defaults to TypeScript)
 * @returns Object with the new source, count of calls transformed, and required imports
 */
export function transformTupleArgsToCall(
  source: string,
  callName: string,
  mappings: readonly TupleToCallMapping[],
  lang: Lang = Lang.TypeScript,
): { output: string; count: number; imports: Array<{ specifier: string; path: string }> } {
  const mappingLookup = new Map(mappings.map((m) => [m.packageName, m]));
  const usedImports: Array<{ specifier: string; path: string }> = [];

  const { output, count } = transformCallArguments(
    source,
    callName,
    (args) => {
      return args
        .map((arg) => {
          if (arg.kind() !== "array") return arg.text();

          const elements = arg
            .children()
            .filter((c) => c.kind() !== "," && c.kind() !== "[" && c.kind() !== "]");
          if (elements.length === 0) return arg.text();

          // First element should be a string literal (package name)
          const packageNode = elements[0];
          if (packageNode.kind() !== "string") return arg.text();

          const fragment = packageNode.children().find((c) => c.kind() === "string_fragment");
          if (!fragment) return arg.text();

          const packageName = fragment.text();
          const mapping = mappingLookup.get(packageName);
          if (!mapping) return arg.text();

          usedImports.push({ specifier: mapping.functionName, path: mapping.importPath });

          // Remaining elements are the config/options
          const configParts = elements.slice(1);
          if (configParts.length === 0) {
            return `${mapping.functionName}()`;
          }

          const configText = configParts.map((c) => c.text()).join(", ");
          return `${mapping.functionName}(${configText})`;
        })
        .join(", ");
    },
    lang,
  );

  return { output, count, imports: usedImports };
}

// ---------------------------------------------------------------------------
// JSON file transformation
// ---------------------------------------------------------------------------

/**
 * Read a JSON file, apply a mutator function, and optionally write back.
 *
 * Unlike `transformFile` which works with raw source strings, this helper parses
 * the JSON and passes the parsed value to the mutator. Output is formatted with
 * 2-space indentation and trailing newline.
 *
 * In dry-run mode, the `before` and `after` fields are populated for diff display.
 * @param filePath - Path to the JSON file to transform
 * @param mutator - Function that takes parsed JSON and returns modified value (or null if no change)
 * @param dryRun - If true, do not write the file
 * @param sourceOverride - Pre-loaded source content (from a previous rule's dry-run output)
 * @returns Result with changed flag and optional before/after content (dry-run only)
 */
export async function transformJsonFile(
  filePath: string,
  mutator: (parsed: unknown) => unknown | null,
  dryRun: boolean,
  sourceOverride?: string,
): Promise<TransformFileResult> {
  const source = sourceOverride ?? (await fs.promises.readFile(filePath, "utf-8"));
  const parsed = JSON.parse(source);
  const result = mutator(parsed);

  if (result == null) {
    return { changed: false };
  }

  const output = JSON.stringify(result, null, 2) + "\n";
  if (output === source) {
    return { changed: false };
  }

  if (!dryRun) {
    await fs.promises.writeFile(filePath, output, "utf-8");
  }

  return {
    changed: true,
    before: dryRun ? source : undefined,
    after: dryRun ? output : undefined,
  };
}
