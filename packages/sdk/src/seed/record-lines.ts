/**
 * Resolve the 1-based physical line a JSONL record occupies.
 *
 * The seed reader drops blank and whitespace-only lines before indexing its
 * records, so a record's index is not its line number once a file contains
 * one. Reported locations have to point at the line a reader would open.
 * @param content - Raw JSONL file contents
 * @param recordIndex - 0-based index among the file's non-blank lines
 * @returns 1-based physical line, or undefined when the file holds no such record
 */
export function physicalLineOfRecord(content: string, recordIndex: number): number | undefined {
  const lines = content.split("\n");
  let remaining = recordIndex;
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    if (remaining === 0) return index + 1;
    remaining -= 1;
  }
  return undefined;
}
