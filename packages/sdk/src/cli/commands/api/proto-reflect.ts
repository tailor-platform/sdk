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

export interface FieldCompletionCandidate {
  value: string;
  description: string;
}

/**
 * Pre-enumerates every `--field` completion candidate for `methodName`,
 * walking the input message tree to produce a flat list that the shell can
 * prefix-filter at TAB time. Used by the `expand` completion variant so no
 * Node process is spawned per keystroke.
 *
 * For each leaf field, emits `key=` (key completion). Enum leaves additionally
 * emit `key=ENUM_VALUE` per value, bool leaves emit `key=true` and
 * `key=false`. For nested messages, emits `key.` (drill-down) and recurses.
 *
 * Returns an empty array when `methodName` is unknown so the `expand`
 * generator stays exception-free at script-generation time.
 * @param methodName - Name of the unary RPC whose input message is being walked
 * @returns Flat list of `{ value, description }` candidates
 */
export function enumerateAllFieldCompletions(methodName: string): FieldCompletionCandidate[] {
  const method = getMethodDescriptor(methodName);
  if (!method) return [];

  const candidates: FieldCompletionCandidate[] = [];
  const visited = new Set<DescMessage>();

  function walk(message: DescMessage, prefix: string): void {
    visited.add(message);
    for (const field of message.fields) {
      // `--field` uses `key=value` with dotted keys building nested objects;
      // it has no syntax for arrays or maps. Skip list/map fields so we don't
      // tab-complete a path that `setNestedPath` would silently turn into the
      // wrong shape (e.g. `subgraphs.name=x` → `{subgraphs:{name:"x"}}` when
      // the proto expects a repeated message).
      if (field.fieldKind === "list" || field.fieldKind === "map") continue;
      const fullKey = prefix + field.localName;
      if (field.fieldKind === "message") {
        const nested = field.message;
        candidates.push({ value: `${fullKey}.`, description: `${fullKey} (message)` });
        if (!visited.has(nested)) walk(nested, `${fullKey}.`);
        continue;
      }
      candidates.push({ value: `${fullKey}=`, description: `Set ${fullKey}` });
      if (field.fieldKind === "enum") {
        for (const v of field.enum.values) {
          candidates.push({ value: `${fullKey}=${v.name}`, description: v.name });
        }
      } else if (field.fieldKind === "scalar" && field.scalar === ScalarType.BOOL) {
        candidates.push({ value: `${fullKey}=true`, description: "true" });
        candidates.push({ value: `${fullKey}=false`, description: "false" });
      }
    }
    visited.delete(message);
  }

  walk(method.input, "");
  return candidates;
}

/**
 * Resolves the leaf `DescField` at a dotted `--field` path within an input
 * message tree. Returns undefined when any segment is missing or when a
 * non-leaf segment isn't a singular message — callers fall back to treating
 * the value as a string in that case.
 * @param input - The RPC input message descriptor
 * @param path - Dot-split path segments to follow (e.g. ["application", "name"])
 * @returns The leaf field descriptor, or undefined when the path doesn't resolve
 */
export function resolveLeafField(input: DescMessage, path: string[]): DescField | undefined {
  let message: DescMessage | undefined = input;
  for (let i = 0; i < path.length; i++) {
    if (!message) return undefined;
    const field: DescField | undefined = message.fields.find((f) => f.localName === path[i]);
    if (!field) return undefined;
    if (i === path.length - 1) return field;
    if (field.fieldKind !== "message") return undefined;
    message = field.message;
  }
  return undefined;
}
