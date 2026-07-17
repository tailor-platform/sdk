import { workflow } from "@tailor-platform/sdk/runtime/workflow";

export function runJob(): unknown {
  return workflow.triggerJobFunction("myJob", { data: "value" });
}
