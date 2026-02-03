/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WorkflowJob, WorkflowJobWithScriptRef } from "./job";
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

/**
 * Workflow with scriptRef mainJob.
 * Uses WorkflowJobWithScriptRef instead of WorkflowJob.
 */
export interface WorkflowWithScriptRef<
  Job extends WorkflowJobWithScriptRef<any> = WorkflowJobWithScriptRef<any>,
> {
  name: string;
  mainJob: Job;
  trigger: (args?: unknown, options?: { authInvoker: AuthInvoker<string> }) => Promise<string>;
}

interface WorkflowDefinition<Job extends WorkflowJob<any, any, any>> {
  name: string;
  mainJob: Job;
}

interface WorkflowDefinitionWithScriptRef<Job extends WorkflowJobWithScriptRef<any>> {
  name: string;
  mainJob: Job;
}

/**
 * Create a workflow definition that can be triggered via the Tailor SDK.
 * In production, bundler transforms .trigger() calls to tailor.workflow.triggerWorkflow().
 * @template Job
 * @param config - Workflow configuration
 * @returns Defined workflow
 */
export function createWorkflow<Job extends WorkflowJob<any, any, any>>(
  config: WorkflowDefinition<Job>,
): Workflow<Job>;

/**
 * Create a workflow definition with scriptRef mainJob.
 * @template Job - WorkflowJobWithScriptRef
 * @param config - Workflow configuration with scriptRef job
 * @returns Defined workflow
 */
export function createWorkflow<Job extends WorkflowJobWithScriptRef<any>>(
  config: WorkflowDefinitionWithScriptRef<Job>,
): WorkflowWithScriptRef<Job>;

export function createWorkflow<
  _Job extends WorkflowJob<any, any, any> | WorkflowJobWithScriptRef<any>,
>(
  config: WorkflowDefinition<any> | WorkflowDefinitionWithScriptRef<any>,
): Workflow<any> | WorkflowWithScriptRef<any> {
  return {
    ...config,
    // For local execution, directly call mainJob.trigger()
    // In production, bundler transforms this to tailor.workflow.triggerWorkflow()
    trigger: async (args: unknown) => {
      await config.mainJob.trigger(...([args] as unknown as []));
      return "00000000-0000-0000-0000-000000000000";
    },
  };
}
