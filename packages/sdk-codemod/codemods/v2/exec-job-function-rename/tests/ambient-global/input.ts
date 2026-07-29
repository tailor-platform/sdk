import "@tailor-platform/sdk/runtime/globals";

export function runJob(): unknown {
  return tailor.workflow.startJobFunction("myJob", { data: "value" });
}
