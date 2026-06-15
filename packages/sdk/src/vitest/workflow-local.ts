/* oxlint-disable typescript/no-explicit-any */
import { TRIGGER_DEFAULT, runRegisteredJob } from "../configure/services/workflow/registry";
import {
  clearWorkflowTestEnv,
  readWorkflowTestEnv,
  writeWorkflowTestEnv,
} from "../configure/services/workflow/test-env-key";
import type { Workflow, WorkflowJob } from "../configure/services/workflow";
import type { TailorWorkflowAPI } from "../runtime/workflow";
import type { TailorEnv } from "../types/env";

type AnyWorkflowJob = WorkflowJob<string, any, any>;
type AnyWorkflow = Workflow<AnyWorkflowJob>;

type WorkflowInput<W extends AnyWorkflow> =
  W["mainJob"] extends WorkflowJob<string, infer I, any> ? I : never;
type WorkflowOutput<W extends AnyWorkflow> =
  W["mainJob"] extends WorkflowJob<string, any, infer O> ? Awaited<O> : never;

type GlobalWithTailor = {
  tailor?: {
    workflow?: TailorWorkflowAPI;
  };
};

export interface RunWorkflowLocallyOptions {
  /** Env passed to workflow job bodies during this local run. */
  env?: TailorEnv;
}

/**
 * Run a workflow's main job and dependent job triggers locally with real job bodies.
 *
 * Use this for local full-chain workflow tests. Regular `.trigger()` calls
 * delegate to the platform workflow runtime and should be mocked with
 * `mockWorkflow()` when you are not intentionally running the local chain.
 * @param workflow - Workflow definition to run
 * @returns The main job output
 */
export function runWorkflowLocally<W extends Workflow<WorkflowJob<string, undefined, any>>>(
  workflow: W,
): Promise<WorkflowOutput<W>>;
/**
 * Run a no-input workflow locally with optional runner settings.
 * @param workflow - Workflow definition to run
 * @param args - Must be `undefined` for no-input workflows
 * @param options - Local runner options
 * @returns The main job output
 */
export function runWorkflowLocally<W extends Workflow<WorkflowJob<string, undefined, any>>>(
  workflow: W,
  args: undefined,
  options?: RunWorkflowLocallyOptions,
): Promise<WorkflowOutput<W>>;
/**
 * Run a workflow locally with real job bodies.
 * @param workflow - Workflow definition to run
 * @param args - Arguments passed to the workflow's main job
 * @param options - Local runner options
 * @returns The main job output
 */
export function runWorkflowLocally<W extends AnyWorkflow>(
  workflow: W,
  args: WorkflowInput<W>,
  options?: RunWorkflowLocallyOptions,
): Promise<WorkflowOutput<W>>;
export async function runWorkflowLocally<W extends AnyWorkflow>(
  workflow: W,
  args?: WorkflowInput<W>,
  options?: RunWorkflowLocallyOptions,
): Promise<WorkflowOutput<W>> {
  const root = globalThis as unknown as GlobalWithTailor;
  const previousTailor = root.tailor;
  const previousEnv = readWorkflowTestEnv();
  const hasPreviousEnv = previousEnv !== undefined;

  if (options?.env !== undefined) {
    writeWorkflowTestEnv({ ...options.env });
  }

  root.tailor = {
    ...previousTailor,
    workflow: createLocalWorkflowRuntime(previousTailor?.workflow),
  };

  try {
    return (await runRegisteredJob(workflow.mainJob.name, args)) as WorkflowOutput<W>;
  } finally {
    if (previousTailor) {
      root.tailor = previousTailor;
    } else {
      delete root.tailor;
    }

    if (options?.env !== undefined) {
      if (hasPreviousEnv) {
        writeWorkflowTestEnv(previousEnv);
      } else {
        clearWorkflowTestEnv();
      }
    }
  }
}

function createLocalWorkflowRuntime(previous?: TailorWorkflowAPI): TailorWorkflowAPI {
  return {
    triggerJobFunction: (name, args) => runRegisteredJob(name, args),
    triggerWorkflow: (name, args, options) =>
      previous ? previous.triggerWorkflow(name, args, options) : Promise.resolve(TRIGGER_DEFAULT),
    wait: (key, payload) => {
      if (previous) {
        return previous.wait(key, payload);
      }
      throw new Error(
        `No wait handler for "${key}". Acquire mockWorkflow() and call setWaitHandler(...).`,
      );
    },
    resolve: async (executionId, key, callback) => {
      if (previous) {
        await previous.resolve(executionId, key, callback);
        return;
      }
      throw new Error(
        "No resolve handler. Acquire mockWorkflow() and call setResolveHandler(...).",
      );
    },
  };
}
