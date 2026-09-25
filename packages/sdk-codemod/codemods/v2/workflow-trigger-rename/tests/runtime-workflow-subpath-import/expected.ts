import { workflow } from "@tailor-platform/sdk/runtime/workflow";

export function runJob(): unknown {
  return workflow.execJobFunction("myJob", { data: "value" });
}
