import { formatTimestamp } from "#/cli/shared/format";
import type { FunctionRegistry } from "@tailor-platform/tailor-proto/function_registry_pb";

export interface FunctionRegistryInfo {
  name: string;
  description: string;
  sizeBytes: string;
  contentHash: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export const functionRegistryInfo = (fn: FunctionRegistry): FunctionRegistryInfo => {
  return {
    name: fn.name,
    description: fn.description,
    sizeBytes: fn.sizeBytes.toString(),
    contentHash: fn.contentHash,
    createdAt: formatTimestamp(fn.createdAt),
    updatedAt: formatTimestamp(fn.updatedAt),
  };
};
