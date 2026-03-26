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
 * @returns Array of matched nodes
 */
export function findPattern(source: string, pattern: string): SgNode[] {
  const root = parseTypeScript(source);
  return root.root().findAll(pattern);
}

interface Edit {
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

  // Collect edits, filtering out nested matches to avoid overlapping rewrites.
  // When findAll returns both an outer and inner match (e.g., foo(foo(1))),
  // applying both edits would corrupt offsets. Keep only outermost matches.
  // Inner occurrences are left unchanged intentionally; running the codemod
  // again will catch them once the outer layer has been rewritten. Iterative
  // rewriting within a single pass risks infinite loops when the replacement
  // still matches the pattern.
  const allEdits: Edit[] = matches.map((match) => {
    const range = match.range();
    return {
      startIndex: range.start.index,
      endIndex: range.end.index,
      newText: replacer(match),
    };
  });

  // Sort by startIndex ascending, then by span length descending (outermost first)
  allEdits.sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);
  const edits: Edit[] = [];
  let lastEnd = -1;
  for (const edit of allEdits) {
    if (edit.startIndex >= lastEnd) {
      edits.push(edit);
      lastEnd = edit.endIndex;
    }
    // else: nested inside the previous match, skip
  }

  // Apply edits in reverse order to preserve offsets
  edits.sort((a, b) => b.startIndex - a.startIndex);
  let output = source;
  for (const edit of edits) {
    output = output.slice(0, edit.startIndex) + edit.newText + output.slice(edit.endIndex);
  }

  return { output, count: edits.length };
}

/**
 * Read a file, apply a transform function, and optionally write back.
 * @param filePath - Path to the file to transform
 * @param transform - Function that takes source and returns transformed source (or null if no change)
 * @param dryRun - If true, do not write the file
 * @returns Whether the file was changed
 */
export async function transformFile(
  filePath: string,
  transform: (source: string) => string | null,
  dryRun: boolean,
): Promise<boolean> {
  const source = await fs.promises.readFile(filePath, "utf-8");
  const result = transform(source);
  if (result === null || result === source) {
    return false;
  }
  if (!dryRun) {
    await fs.promises.writeFile(filePath, result, "utf-8");
  }
  return true;
}
