import { OperatorService } from "@tailor-proto/tailor/v1/service_pb";
import type { DescField, DescMessage, DescMethodUnary } from "@bufbuild/protobuf";

export function listMethodNames(): string[] {
  return OperatorService.methods.map((m) => m.name).sort();
}

export function getMethodDescriptor(methodName: string): DescMethodUnary | undefined {
  return OperatorService.methods.find((m) => m.name === methodName) as DescMethodUnary | undefined;
}

export function getInputFieldByName(message: DescMessage, segment: string): DescField | undefined {
  return message.fields.find((f) => f.localName === segment || f.jsonName === segment);
}

export function resolveFieldByPath(
  rootMessage: DescMessage,
  path: ReadonlyArray<string>,
): DescField | undefined {
  if (path.length === 0) return undefined;
  let current: DescMessage | undefined = rootMessage;
  let field: DescField | undefined;
  for (let i = 0; i < path.length; i++) {
    if (!current) return undefined;
    const segment = path[i];
    if (segment === undefined) return undefined;
    field = getInputFieldByName(current, segment);
    if (!field) return undefined;
    if (i < path.length - 1) {
      const nestedMessage = nestedMessageOf(field);
      if (!nestedMessage) return undefined;
      current = nestedMessage;
    }
  }
  return field;
}

export function nestedMessageOf(field: DescField): DescMessage | undefined {
  if (field.fieldKind === "message") return field.message;
  if (field.fieldKind === "list" && field.listKind === "message") return field.message;
  return undefined;
}

export function extractMethodName(endpoint: string): string {
  if (!endpoint.includes("/")) return endpoint;
  return endpoint.split("/").pop() ?? endpoint;
}
