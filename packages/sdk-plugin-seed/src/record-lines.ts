import { readFile } from "node:fs/promises";
import type { ValidationErrorDetail } from "lines-db";

/**
 * Split JSONL content into the lines that hold records, as the seed validator
 * reads them: a leading byte order mark and each line's trailing carriage
 * return are dropped, and blank or whitespace-only lines are skipped.
 * @param content - Raw JSONL file contents
 * @returns Each record's text with its 1-based physical line
 */
export function jsonlRecordLines(content: string): { text: string; line: number }[] {
  const lines = (content.startsWith("\uFEFF") ? content.slice(1) : content).split("\n");
  return lines.flatMap((raw, index) => {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    return text.trim().length === 0 ? [] : [{ text, line: index + 1 }];
  });
}

/**
 * Resolve the 1-based physical line a JSONL record occupies.
 *
 * The validator drops blank and whitespace-only lines before indexing its
 * records, so a record's index is not its line number once a file contains
 * one. Reported locations have to point at the line a reader would open.
 * @param content - Raw JSONL file contents
 * @param recordIndex - 0-based index among the file's non-blank lines
 * @returns 1-based physical line, or undefined when the file holds no such record
 */
export function physicalLineOfRecord(content: string, recordIndex: number): number | undefined {
  return jsonlRecordLines(content)[recordIndex]?.line;
}

/**
 * Locate the first reported error in its own file.
 *
 * Errors are reported per record, so the index is mapped back to a physical
 * line; a file that cannot be re-read yields the file alone rather than a
 * guessed line.
 * @param errors - Validation errors in the order the validator reported them
 * @returns Location of the first error, or undefined when there is none
 */
export async function firstErrorLocation(
  errors: readonly ValidationErrorDetail[],
): Promise<{ file: string; line?: number } | undefined> {
  const first = errors[0];
  if (!first) return undefined;
  try {
    const content = await readFile(first.file, "utf-8");
    return { file: first.file, line: physicalLineOfRecord(content, first.rowIndex) };
  } catch {
    return { file: first.file };
  }
}
