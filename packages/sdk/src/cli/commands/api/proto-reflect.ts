import { ScalarType } from "@bufbuild/protobuf";
import { OperatorService } from "@tailor-proto/tailor/v1/service_pb";
import type { DescField, DescMessage, DescMethodUnary } from "@bufbuild/protobuf";

// `tailor-sdk api` issues a single JSON POST and reads one JSON response, so
// only unary RPCs can be invoked. Streaming methods are filtered out of all
// discovery surfaces (`api list`, `api inspect`).
function unaryMethods(): DescMethodUnary[] {
  return OperatorService.methods.filter((m): m is DescMethodUnary => m.methodKind === "unary");
}

export function listMethodNames(): string[] {
  return unaryMethods()
    .map((m) => m.name)
    .sort();
}

export function getMethodDescriptor(methodName: string): DescMethodUnary | undefined {
  return unaryMethods().find((m) => m.name === methodName);
}

export function extractMethodName(endpoint: string): string {
  if (!endpoint.includes("/")) return endpoint;
  return endpoint.split("/").pop() ?? endpoint;
}

/**
 * Returns the nested message descriptor when the field is a message, a list of
 * messages, or a map with message values. Otherwise returns undefined.
 * @param field - The proto field descriptor to inspect
 * @returns The nested message descriptor, or undefined when the field isn't message-shaped
 */
export function nestedMessage(field: DescField): DescMessage | undefined {
  if (field.fieldKind === "message") return field.message;
  if (field.fieldKind === "list" && field.listKind === "message") return field.message;
  if (field.fieldKind === "map" && field.mapKind === "message") return field.message;
  return undefined;
}

export interface InputFieldChild {
  /** Field name in camelCase (matches what JSON request bodies use). */
  name: string;
  /** True when the field is a message (or list/map of messages) — can be drilled into with a dot. */
  isMessage: boolean;
}

/**
 * Enumerates the immediate child fields under `containerPath` for the input
 * message of `methodName`. Used to drive dot-by-dot completion of `--field`.
 *
 * `containerPath` is the dot-separated path from the input message root to the
 * container whose children should be listed (empty array means the input
 * message itself).
 * @param methodName - Name of the unary RPC whose input message is being walked
 * @param containerPath - Segments traversed before reaching the container to list
 * @returns Immediate children, or an empty array when the method is unknown,
 *   the path traverses a non-message field, or a recursive cycle is hit
 */
export function listInputFieldChildren(
  methodName: string,
  containerPath: string[],
): InputFieldChild[] {
  const method = getMethodDescriptor(methodName);
  if (!method) return [];

  let message: DescMessage = method.input;
  const visited = new Set<DescMessage>([message]);
  for (const segment of containerPath) {
    const field = message.fields.find((f) => f.localName === segment);
    if (!field) return [];
    const next = nestedMessage(field);
    if (!next || visited.has(next)) return [];
    visited.add(next);
    message = next;
  }

  return message.fields.map((field) => ({
    name: field.localName,
    isMessage: nestedMessage(field) !== undefined,
  }));
}

export type InputFieldType =
  | { kind: "enum"; values: string[] }
  | { kind: "bool" }
  | { kind: "scalar" }
  | { kind: "message" };

/**
 * Resolves the type of the leaf field reached by walking `path` from the input
 * message of `methodName`. Used to drive value-side completion of `--field`.
 *
 * Returns `undefined` when the path is empty, the method is unknown, the path
 * traverses a non-message field, or the leaf field doesn't exist. List and map
 * fields collapse to `"message"` — value assignment via `key=value` doesn't
 * apply, so callers should suppress completion.
 * @param methodName - Name of the unary RPC whose input message is being walked
 * @param path - Dotted segments from the input root to the leaf field
 * @returns The leaf field's type, or undefined when the path is unresolvable
 */
export function getInputFieldType(methodName: string, path: string[]): InputFieldType | undefined {
  if (path.length === 0) return undefined;
  const method = getMethodDescriptor(methodName);
  if (!method) return undefined;

  let message: DescMessage = method.input;
  const visited = new Set<DescMessage>([message]);
  for (let i = 0; i < path.length - 1; i++) {
    const field = message.fields.find((f) => f.localName === path[i]);
    if (!field) return undefined;
    const next = nestedMessage(field);
    if (!next || visited.has(next)) return undefined;
    visited.add(next);
    message = next;
  }

  const leaf = message.fields.find((f) => f.localName === path[path.length - 1]);
  if (!leaf) return undefined;

  if (leaf.fieldKind === "enum") {
    return { kind: "enum", values: leaf.enum.values.map((v) => v.name) };
  }
  if (leaf.fieldKind === "scalar") {
    return leaf.scalar === ScalarType.BOOL ? { kind: "bool" } : { kind: "scalar" };
  }
  return { kind: "message" };
}
