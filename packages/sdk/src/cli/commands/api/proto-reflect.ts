import { OperatorService } from "@tailor-proto/tailor/v1/service_pb";
import type { DescMethodUnary } from "@bufbuild/protobuf";

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
