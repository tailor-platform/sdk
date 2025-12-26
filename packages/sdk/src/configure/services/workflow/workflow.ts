/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WorkflowJob } from "./job";
import type { AuthInvoker } from "../auth";

export interface WorkflowConfig<
  Job extends WorkflowJob<any, any, any> = WorkflowJob<any, any, any>,
> {
  name: string;
  mainJob: Job;
}

export interface Workflow<Job extends WorkflowJob<any, any, any> = WorkflowJob<any, any, any>> {
  name: string;
  mainJob: Job;
  trigger: (
    args: Parameters<Job["trigger"]>[0],
    options?: { authInvoker: AuthInvoker<string> },
  ) => Promise<string>;
}

export function createWorkflow<Job extends WorkflowJob<any, any, any>>(config: {
  name: string;
  mainJob: Job;
}): Workflow<Job> {
  return {
    ...config,
    trigger: async (args, options) => {
      return tailor.workflow.triggerWorkflow(
        config.name,
        args,
        options ? { authInvoker: options.authInvoker } : undefined,
      );
    },
  };
}
