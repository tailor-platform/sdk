import { OperatorService } from "@tailor-proto/tailor/v1/service_pb";
import type { DescField, DescMessage, DescMethodUnary } from "@bufbuild/protobuf";

// `tailor-sdk api` issues a single JSON POST and reads one JSON response, so
// only unary RPCs can be invoked. Streaming methods are filtered out of all
// discovery surfaces (`--list`, completion, `--inspect`).
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

export function getInputFieldByName(message: DescMessage, segment: string): DescField | undefined {
  return message.fields.find((f) => f.localName === segment || f.jsonName === segment);
}

/**
 * Return the message a dot-notation `--field` path is allowed to descend into.
 * Repeated messages serialize to JSON arrays (not objects) and well-known types
 * (google.protobuf.*) have bespoke JSON encodings, so neither can be assembled
 * from `--field key=value` entries without producing invalid request bodies.
 * @param field - Proto field to inspect
 * @returns The descendable message, or undefined when dot-notation is unsafe
 */
export function descendableMessageOf(field: DescField): DescMessage | undefined {
  if (field.fieldKind !== "message") return undefined;
  if (field.message.typeName.startsWith("google.protobuf.")) return undefined;
  return field.message;
}

export function extractMethodName(endpoint: string): string {
  if (!endpoint.includes("/")) return endpoint;
  return endpoint.split("/").pop() ?? endpoint;
}
