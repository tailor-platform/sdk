/* oxlint-disable typescript/no-explicit-any */
import { TRIGGER_DEFAULT, getRegisteredJob } from "../configure/services/workflow/registry";
import {
  buildJobContext,
  clearWorkflowTestEnv,
  readWorkflowTestEnv,
  writeWorkflowTestEnv,
} from "../configure/services/workflow/test-env-key";
import { platformSerialize } from "../utils/test/platform-serialize";
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

interface TriggerRecord {
  jobName: string;
  args: unknown;
  result: unknown;
}

interface LocalExecution {
  records: TriggerRecord[];
  cursor: number;
}

class PendingTrigger {
  constructor(
    readonly jobName: string,
    readonly args: unknown,
  ) {}
}

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
  const runner = createLocalJobRunner();

  if (options?.env !== undefined) {
    writeWorkflowTestEnv({ ...options.env });
  }

  root.tailor = {
    ...previousTailor,
    workflow: createLocalWorkflowRuntime(previousTailor?.workflow, runner.triggerJobFunction),
  };

  try {
    return (await runner.runJob(workflow.mainJob.name, args)) as WorkflowOutput<W>;
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

function createLocalJobRunner(): {
  runJob: (name: string, args?: unknown) => Promise<unknown>;
  triggerJobFunction: (name: string, args?: unknown) => unknown;
} {
  let activeExecution: LocalExecution | undefined;

  const triggerJobFunction = (jobName: string, args?: unknown): unknown => {
    if (!activeExecution) {
      throw new Error(
        `Cannot trigger workflow job "${jobName}" outside runWorkflowLocally() job execution.`,
      );
    }

    const serializedArgs = platformSerialize(args);
    const index = activeExecution.cursor;
    activeExecution.cursor += 1;

    const cached = activeExecution.records[index];
    if (cached) {
      assertSameTrigger(cached, jobName, serializedArgs);
      return cached.result;
    }

    throw new PendingTrigger(jobName, serializedArgs);
  };

  const runJob = async (name: string, args?: unknown): Promise<unknown> => {
    const body = getRegisteredJob(name);
    if (!body) {
      return null;
    }

    const records: TriggerRecord[] = [];

    for (;;) {
      const execution: LocalExecution = { records, cursor: 0 };
      const previousExecution = activeExecution;
      activeExecution = execution;

      try {
        const out = await body(platformSerialize(args), buildJobContext());
        if (execution.cursor !== records.length) {
          throw new Error(
            `Workflow job trigger sequence changed while replaying "${name}". Expected ${records.length} trigger(s), but replay reached ${execution.cursor}.`,
          );
        }
        return platformSerialize(out);
      } catch (cause) {
        if (cause instanceof PendingTrigger) {
          const result = await runJob(cause.jobName, cause.args);
          records.push({ jobName: cause.jobName, args: cause.args, result });
          continue;
        }
        throw cause;
      } finally {
        activeExecution = previousExecution;
      }
    }
  };

  return { runJob, triggerJobFunction };
}

function assertSameTrigger(record: TriggerRecord, jobName: string, args: unknown): void {
  if (record.jobName === jobName && JSON.stringify(record.args) === JSON.stringify(args)) {
    return;
  }

  throw new Error(
    `Workflow job trigger sequence changed while replaying. Expected ${record.jobName}(${JSON.stringify(record.args)}), but got ${jobName}(${JSON.stringify(args)}).`,
  );
}

function createLocalWorkflowRuntime(
  previous: TailorWorkflowAPI | undefined,
  triggerJobFunction: (name: string, args?: unknown) => unknown,
): TailorWorkflowAPI {
  return {
    triggerJobFunction,
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
