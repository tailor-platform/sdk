import { workflow } from "@tailor-platform/sdk/runtime";

export function runJob(): unknown {
  return workflow.execJobFunction("myJob", { data: "value" });
}
