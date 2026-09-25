import { workflow } from "@tailor-platform/sdk/runtime";

export function runJob(): unknown {
  const workflow = { startJobFunction: (name: string): string => name };
  return workflow.startJobFunction("myJob");
}
