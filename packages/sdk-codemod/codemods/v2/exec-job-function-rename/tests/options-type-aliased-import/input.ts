import type { StartJobFunctionOptions as JobOptions } from "@tailor-platform/sdk/runtime/workflow";

export function withOptions(options: JobOptions): JobOptions {
  return options;
}
