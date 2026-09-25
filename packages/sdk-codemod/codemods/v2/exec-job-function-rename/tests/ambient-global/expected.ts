import "@tailor-platform/sdk/runtime/globals";

export function runJob(): unknown {
  return tailor.workflow.execJobFunction("myJob", { data: "value" });
}
