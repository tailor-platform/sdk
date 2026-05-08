/**
 * Extract the first ts/tsx code block from an LLM response, or fall back
 * to the whole text if none is found.
 */
export function extractCodeBlock(raw: string): { code: string; preambleChars: number } {
  const fence = /```(?:ts|tsx|typescript|javascript|js)?\s*\n([\s\S]*?)```/i;
  const m = fence.exec(raw);
  if (m) {
    return { code: m[1].trimEnd(), preambleChars: m.index };
  }
  // Fall back to whole text
  return { code: raw.trim(), preambleChars: 0 };
}
