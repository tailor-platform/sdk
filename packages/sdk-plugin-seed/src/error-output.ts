import { errorToJson } from "@tailor-platform/sdk/cli";

export function serializeError(error: unknown, includeStack: boolean): string {
  return JSON.stringify(errorToJson(error, { includeStack }));
}
