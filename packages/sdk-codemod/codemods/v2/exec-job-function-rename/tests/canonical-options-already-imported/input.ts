import type {
  ExecJobFunctionOptions,
  StartJobFunctionOptions,
} from "@tailor-platform/sdk/runtime/workflow";

export function withOptions(options: StartJobFunctionOptions): ExecJobFunctionOptions {
  return options;
}
