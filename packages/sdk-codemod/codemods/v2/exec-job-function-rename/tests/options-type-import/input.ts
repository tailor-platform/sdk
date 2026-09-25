import { workflow, type StartJobFunctionOptions } from "@tailor-platform/sdk/runtime/workflow";

export function runJob(options: StartJobFunctionOptions): unknown {
  return workflow.startJobFunction("myJob", { data: "value" }, options);
}
