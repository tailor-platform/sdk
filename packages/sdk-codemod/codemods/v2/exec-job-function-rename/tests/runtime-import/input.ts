import { workflow } from "@tailor-platform/sdk/runtime";

export function runJob(): unknown {
  return workflow.startJobFunction("myJob", { data: "value" });
}
