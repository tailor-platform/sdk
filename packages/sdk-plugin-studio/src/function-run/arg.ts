import {
  JsonArrayNode,
  JsonObjectNode,
  JsonParser,
  type JsonPropertyNode,
  type JsonValueNode,
} from "@croct/json5-parser";

export interface TextRange {
  from: number;
  to: number;
}

function parse(text: string): JsonValueNode | undefined {
  try {
    return JsonParser.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Read an argument written as JSON or JSON5 and turn it into plain JSON.
 * @param text - What the user typed; empty means no argument
 * @returns Plain JSON (`{}` for an empty argument), or undefined when it cannot be parsed
 */
export function normalizeArg(text: string): string | undefined {
  if (text.trim() === "") return "{}";
  const node = parse(text);
  return node === undefined ? undefined : JSON.stringify(node.toJSON());
}

function keyName(property: JsonPropertyNode): string {
  return String(property.key.toJSON());
}

function childOf(node: JsonValueNode, segment: string | number): JsonValueNode | undefined {
  if (node instanceof JsonObjectNode) {
    return node.properties.find((property) => keyName(property) === String(segment))?.value;
  }
  if (node instanceof JsonArrayNode) return node.elements[Number(segment)];
  return undefined;
}

function rangeOf(node: JsonValueNode): TextRange {
  return { from: node.location.start.index, to: node.location.end.index };
}

/**
 * Find where a path of an argument sits in the text the user typed. A path that stops short of
 * the text (a missing key, an index past the end) points at the opening brace or bracket of
 * the deepest object or array that exists.
 * @param text - The argument as typed, JSON or JSON5
 * @param path - Keys and indexes from the top of the argument
 * @returns The range to mark, or undefined when the path is empty or the text does not parse
 */
export function locateArgPath(
  text: string,
  path: readonly (string | number)[],
): TextRange | undefined {
  if (path.length === 0) return undefined;
  let node = parse(text);
  if (node === undefined) return undefined;
  for (const segment of path) {
    const child = childOf(node, segment);
    if (child === undefined) {
      const isContainer = node instanceof JsonObjectNode || node instanceof JsonArrayNode;
      const { from } = rangeOf(node);
      return isContainer ? { from, to: from + 1 } : rangeOf(node);
    }
    node = child;
  }
  return rangeOf(node);
}
