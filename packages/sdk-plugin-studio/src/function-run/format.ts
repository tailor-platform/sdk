import { format } from "oxfmt";

/**
 * Format TypeScript so two texts that differ only in layout come out the same.
 * @param code - TypeScript source
 * @returns The formatted source, or undefined when it has a syntax error
 */
export async function formatTypeScript(code: string): Promise<string | undefined> {
  const result = await format("function.ts", code);
  return result.errors.length === 0 ? result.code : undefined;
}
