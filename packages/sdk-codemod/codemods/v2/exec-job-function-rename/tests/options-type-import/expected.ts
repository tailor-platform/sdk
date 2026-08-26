import { workflow, type ExecJobFunctionOptions } from "@tailor-platform/sdk/runtime/workflow";

export function runJob(options: ExecJobFunctionOptions): unknown {
  return workflow.execJobFunction("myJob", { data: "value" }, options);
}
