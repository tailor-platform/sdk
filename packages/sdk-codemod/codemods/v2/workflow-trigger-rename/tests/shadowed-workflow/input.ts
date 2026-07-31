import { workflow } from "@tailor-platform/sdk/runtime";

function run(): unknown {
  const workflow = getLocalWorkflow();
  return workflow.triggerWorkflow("local");
}

function getLocalWorkflow(): { triggerWorkflow: (name: string) => string } {
  return { triggerWorkflow: (name) => name };
}
