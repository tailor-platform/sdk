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
import type { TailorEnv } from "../runtime/types";
import type { TailorWorkflowAPI } from "../runtime/workflow";

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

type TriggerRecord = {
  jobName: string;
  args: unknown;
} & (
  | {
      status: "fulfilled";
      result: unknown;
    }
  | {
      status: "rejected";
      error: unknown;
    }
);

interface LocalExecution {
  records: TriggerRecord[];
  cursor: number;
  pending?: PendingTrigger;
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
    if (activeExecution.pending) {
      throw activeExecution.pending;
    }

    const serializedArgs = platformSerialize(args);
    const index = activeExecution.cursor;
    activeExecution.cursor += 1;

    const cached = activeExecution.records[index];
    if (cached) {
      assertSameTrigger(cached, jobName, serializedArgs);
      if (cached.status === "rejected") {
        throw cached.error;
      }
      return platformSerialize(cached.result);
    }

    const pending = new PendingTrigger(jobName, serializedArgs);
    activeExecution.pending = pending;
    throw pending;
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
        if (execution.pending) {
          await settlePendingTrigger(records, execution.pending, runJob);
          continue;
        }
        if (execution.cursor !== records.length) {
          throw new Error(
            `Workflow job trigger sequence changed while replaying "${name}". Expected ${records.length} trigger(s), but replay reached ${execution.cursor}.`,
          );
        }
        return platformSerialize(out);
      } catch (cause) {
        const pending = cause instanceof PendingTrigger ? cause : execution.pending;
        if (pending) {
          await settlePendingTrigger(records, pending, runJob);
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

async function settlePendingTrigger(
  records: TriggerRecord[],
  pending: PendingTrigger,
  runJob: (name: string, args?: unknown) => Promise<unknown>,
): Promise<void> {
  try {
    records.push({
      jobName: pending.jobName,
      args: pending.args,
      status: "fulfilled",
      result: await runJob(pending.jobName, pending.args),
    });
  } catch (error) {
    records.push({
      jobName: pending.jobName,
      args: pending.args,
      status: "rejected",
      error,
    });
  }
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
    triggerWorkflow: async (name, args, options) => {
      if (previous) {
        return await previous.triggerWorkflow(name, args, options);
      }
      platformSerialize(args);
      return TRIGGER_DEFAULT;
    },
    resumeWorkflow: async (executionId) => {
      if (previous) {
        return await previous.resumeWorkflow(executionId);
      }
      return executionId;
    },
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
