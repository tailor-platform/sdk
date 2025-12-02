import type { TailorEnv } from "@/configure/types/env";

/**
 * Symbol used to brand WorkflowJob objects created by createWorkflowJob.
 * This enables reliable runtime detection of workflow jobs regardless of
 * how they were imported or assigned (variable reassignment, destructuring, etc.)
 */
export const WORKFLOW_JOB_BRAND = Symbol.for("tailor:workflow-job");

/**
 * Context object passed as the second argument to workflow job body functions.
 */
export type WorkflowJobContext = {
  env: TailorEnv;
};

export interface WorkflowJob<
  Name extends string = string,
  Input = any,
  Output = any,
> {
  readonly [WORKFLOW_JOB_BRAND]?: true;
  name: Name;
  /**
   * Trigger this job with the given input.
   * At runtime, this is a placeholder that calls the body function.
   * During bundling, calls to .trigger() are transformed to
   * tailor.workflow.triggerJobFunction("<job-name>", args).
   */
  trigger: [Input] extends [undefined]
    ? () => Promise<Awaited<Output>>
    : (input: Input) => Promise<Awaited<Output>>;
  body: (input: Input, context: WorkflowJobContext) => Output | Promise<Output>;
}

type WorkflowJobBody<I, O> = (
  input: I,
  context: WorkflowJobContext,
) => O | Promise<O>;

export const createWorkflowJob = <
  const Name extends string,
  const Body extends WorkflowJobBody<any, any>,
>(config: {
  readonly name: Name;
  readonly body: Body;
}): WorkflowJob<Name, Parameters<Body>[0], ReturnType<Body>> => {
  return {
    [WORKFLOW_JOB_BRAND]: true,
    name: config.name,
    // trigger is a placeholder - transformed to triggerJobFunction at bundle time
    trigger: config.body as any,
    body: config.body,
  } as WorkflowJob<Name, Parameters<Body>[0], ReturnType<Body>>;
};
