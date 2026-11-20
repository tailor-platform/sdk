import JSON5 from "json5";

/**
 * Read an argument written as JSON or JSON5 and turn it into plain JSON.
 * @param text - What the user typed; empty means no argument
 * @returns Plain JSON (`{}` for an empty argument), or undefined when it cannot be parsed
 */
export function normalizeArg(text: string): string | undefined {
  if (text.trim() === "") return "{}";
  try {
    return JSON.stringify(JSON5.parse(text));
  } catch {
    return undefined;
  }
}
