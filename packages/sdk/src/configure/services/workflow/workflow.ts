/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WorkflowJob } from "./job";

export interface WorkflowConfig<
  Job extends WorkflowJob<any, any, any> = WorkflowJob<any, any, any>,
> {
  name: string;
  mainJob: Job;
}

export interface Workflow<
  Job extends WorkflowJob<any, any, any> = WorkflowJob<any, any, any>,
> {
  name: string;
  mainJob: Job;
}

export function createWorkflow<Job extends WorkflowJob<any, any, any>>(
  config: WorkflowConfig<Job>,
): Workflow<Job> {
  return config;
}
