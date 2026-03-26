import * as fs from "node:fs";
import { type SgNode, type SgRoot, Lang, parse } from "@ast-grep/napi";

export type { SgNode, SgRoot };
export { Lang };

/**
 * Parse a TypeScript source string into an ast-grep root node.
 * @param source - TypeScript source code string
 * @returns Parsed ast-grep root node
 */
export function parseTypeScript(source: string): SgRoot {
  return parse(Lang.TypeScript, source);
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
 * @returns Object with the new source and count of replacements made
 */
export function applyPatternReplace(
  source: string,
  pattern: string,
  replacer: (node: SgNode) => string,
): { output: string; count: number } {
  const root = parseTypeScript(source);
  const matches = root.root().findAll(pattern);
  if (matches.length === 0) {
    return { output: source, count: 0 };
  }

  // Collect edits
  const edits: Edit[] = matches.map((match) => {
    const range = match.range();
    return {
      startIndex: range.start.index,
      endIndex: range.end.index,
      newText: replacer(match),
    };
  });

  // Apply edits in reverse order to preserve offsets
  edits.sort((a, b) => b.startIndex - a.startIndex);
  let output = source;
  for (const edit of edits) {
    output = output.slice(0, edit.startIndex) + edit.newText + output.slice(edit.endIndex);
  }

  return { output, count: matches.length };
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
