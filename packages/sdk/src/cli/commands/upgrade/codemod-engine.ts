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
  // Use rule-based query to match both identifier and property_identifier node kinds
  return root.root().findAll({
    rule: {
      any: [
        { kind: "identifier", regex: `^${escapedName}$` },
        { kind: "property_identifier", regex: `^${escapedName}$` },
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
  return { output: source.replaceAll(oldName, newName), count: matches.length };
}

/**
 * Rename multiple identifiers in a single pass over the source.
 *
 * Automatically sorts renames by key length (longest first) to prevent substring
 * conflicts when using `replaceAll`. For example, `createWorkflowJob` is processed
 * before `createWorkflow` so the shorter name doesn't corrupt the longer one.
 *
 * Uses `findIdentifiers` for detection, so both `identifier` and `property_identifier`
 * nodes are matched.
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

  // Apply in reverse to preserve character offsets
  let output = source;
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i];
    output = output.slice(0, edit.startIndex) + edit.newText + output.slice(edit.endIndex);
  }

  return { output, count: edits.length };
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
 * @returns Result with changed flag and optional before/after content (dry-run only)
 */
export async function transformFile(
  filePath: string,
  transform: (source: string) => string | null,
  dryRun: boolean,
): Promise<TransformFileResult> {
  const source = await fs.promises.readFile(filePath, "utf-8");
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

  let output = source;
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i];
    output = output.slice(0, edit.startIndex) + edit.newText + output.slice(edit.endIndex);
  }

  return { output, count: edits.length };
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

  let output = source;
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i];
    output = output.slice(0, edit.startIndex) + edit.newText + output.slice(edit.endIndex);
  }

  return { output, count: edits.length };
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
// ---------------------------------------------------------------------------

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

      const pairs = innerRoot
        .root()
        .findAll({ rule: { kind: "pair" } } as Parameters<SgNode["findAll"]>[0]);

      const matchingPair = pairs.find((pair) => {
        const key = pair.children().find((c) => c.kind() === "property_identifier");
        return key?.text() === propertyName;
      });

      if (!matchingPair) return text;

      // Find the parent object to check if this is the only pair
      const objects = innerRoot
        .root()
        .findAll({ rule: { kind: "object" } } as Parameters<SgNode["findAll"]>[0]);
      const parentObj = objects.find((obj) => {
        const objPairs = obj.children().filter((c) => c.kind() === "pair");
        return objPairs.some((p) => {
          const key = p.children().find((c) => c.kind() === "property_identifier");
          return key?.text() === propertyName;
        });
      });

      if (parentObj) {
        const directPairs = parentObj.children().filter((c) => c.kind() === "pair");
        if (directPairs.length === 1) {
          // Only pair in this object - replace entire object with empty `{}`
          const objRange = parentObj.range();
          return text.slice(0, objRange.start.index) + "{}" + text.slice(objRange.end.index);
        }
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

      const objects = innerRoot
        .root()
        .findAll({ rule: { kind: "object" } } as Parameters<SgNode["findAll"]>[0]);

      if (objects.length === 0) return text;

      // Use the first (outermost) object
      const obj = objects[0];
      const objRange = obj.range();
      const objText = obj.text();

      // Check if property already exists
      const pairs = obj.findAll({ rule: { kind: "pair" } } as Parameters<SgNode["findAll"]>[0]);
      const alreadyExists = pairs.some((p) => {
        const key = p.children().find((c) => c.kind() === "property_identifier");
        return key?.text() === propertyName;
      });
      if (alreadyExists) return text;

      const newProp = `${propertyName}: ${propertyValue}`;
      const closeBraceIdx = objText.lastIndexOf("}");
      if (closeBraceIdx === -1) return text;

      const beforeClose = objText.substring(0, closeBraceIdx);
      const trimmedBefore = beforeClose.trimEnd();

      let modified: string;
      if (trimmedBefore === "{") {
        // Empty object: `{}` -> `{ prop: val }`
        modified = `{ ${newProp} }`;
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
