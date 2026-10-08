import { Code, ConnectError } from "@connectrpc/connect";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { writeMetadataLabelsDirect } from "../label";
import {
  executeMigrationStepsAsWorkflow,
  migrationPlanFingerprint,
  removeMigrationWorkflowResources,
  type MigrationStepsWorkflowOptions,
} from "./migration-workflow";
import type { OperatorClient } from "#/cli/shared/client";
import type { AuthInvoker } from "@tailor-platform/tailor-proto/auth_resource_pb";

vi.mock("#/cli/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    newline: vi.fn(),
    log: vi.fn(),
  },
  styles: { bold: (s: string) => s },
}));

vi.mock("../label", async (importOriginal) => ({
  ...(await importOriginal()),
  resourceTrn: (workspaceId: string, kind: string, name: string) =>
    `trn:v1:workspace:${workspaceId}:${kind}:${name}`,
  writeMetadataLabelsDirect: vi.fn(),
  buildMetaRequest: vi.fn(async (params: unknown) => params),
}));

const NAME = "tailordb-migration--tailordb--0003";
const RUNNER = `${NAME}--step`;
const ORDER = ["backfillUser", "backfillInvoice", "recomputeTotals"];
const invoker = { namespace: "auth", machineUserName: "migrator" } as AuthInvoker;

interface JobSpec {
  callIndex?: number;
  name?: string;
  status: WorkflowJobExecution_Status;
  logs?: string[];
  error?: string;
  result?: string;
}

interface ExecutionSpec {
  id: string;
  status: WorkflowExecution_Status;
  jobs?: JobSpec[];
}

interface StepsClientOptions {
  /** Temporary workflow left by an earlier run, with the plan it was created for. */
  existingWorkflow?: { id: string; plan?: string };
  /** Executions the platform lists for the temporary workflow name, newest first. */
  listed?: ExecutionSpec[];
  /** Status sequence and jobs of the execution this run starts or resumes. */
  run?: { statuses: WorkflowExecution_Status[]; jobs?: JobSpec[] };
  pollFailure?: Error;
  /** Makes starting the run fail, after the platform created its execution or before. */
  startFailure?: { error: Error; afterCreating: boolean };
}

function runnerJob(callIndex: number, status: WorkflowJobExecution_Status, logs: string[] = []) {
  return { callIndex, name: RUNNER, status, logs };
}

function createStepsClient(options: StepsClientOptions = {}) {
  const calls: string[] = [];
  const executions = new Map<string, ExecutionSpec>(
    (options.listed ?? []).map((execution) => [execution.id, execution]),
  );
  let polls = 0;
  let activeRunId: string | undefined;

  const toExecution = (spec: ExecutionSpec, status: WorkflowExecution_Status) => ({
    id: spec.id,
    status,
    jobExecutions: (spec.jobs ?? []).map((job, index) => ({
      executionId: `${spec.id}-fn-${index}`,
      status: job.status,
      position: job.callIndex === undefined ? { depth: 0 } : { callIndex: job.callIndex, depth: 1 },
      kind: { case: "jobFunction", value: { name: job.name ?? NAME } },
    })),
  });

  const functionExecutions = new Map<string, JobSpec>();
  const remember = (spec: ExecutionSpec) =>
    (spec.jobs ?? []).forEach((job, index) =>
      functionExecutions.set(`${spec.id}-fn-${index}`, job),
    );
  for (const spec of executions.values()) remember(spec);

  const startRun = (id: string) => {
    activeRunId = id;
    const spec = { id, status: WorkflowExecution_Status.RUNNING, jobs: options.run?.jobs };
    executions.set(id, spec);
    remember(spec);
  };

  const raw = {
    getWorkflowByName: vi.fn(async () => {
      calls.push("getWorkflowByName");
      if (!options.existingWorkflow) throw new ConnectError("not found", Code.NotFound);
      return { workflow: { id: options.existingWorkflow.id } };
    }),
    getMetadata: vi.fn(async ({ trn }: { trn: string }) => {
      calls.push(`getMetadata ${trn}`);
      const plan = options.existingWorkflow?.plan;
      return { metadata: { labels: plan ? { "sdk-migration-plan": plan } : {} } };
    }),
    listWorkflowExecutions: vi.fn(async () => {
      calls.push("listWorkflowExecutions");
      if (!options.existingWorkflow) throw new ConnectError("not found", Code.NotFound);
      return {
        executions: (options.listed ?? []).map((spec) => toExecution(spec, spec.status)),
        nextPageToken: "",
      };
    }),
    createFunctionRegistry: vi.fn(async () => calls.push("createFunctionRegistry")),
    updateFunctionRegistry: vi.fn(async () => calls.push("updateFunctionRegistry")),
    createWorkflowJobFunction: vi.fn(async ({ jobFunctionName }: { jobFunctionName: string }) => {
      calls.push(`createWorkflowJobFunction ${jobFunctionName}`);
      return { jobFunction: { version: jobFunctionName === RUNNER ? 2n : 1n } };
    }),
    createWorkflow: vi.fn(async () => {
      calls.push("createWorkflow");
      return { workflow: { id: "wf-new" } };
    }),
    startWorkflow: vi.fn(async () => {
      calls.push("startWorkflow");
      const failure = options.startFailure;
      if (failure && !failure.afterCreating) throw failure.error;
      startRun("exec-new");
      if (failure) throw failure.error;
      return { executionId: "exec-new" };
    }),
    resumeWorkflowExecution: vi.fn(async ({ executionId }: { executionId: string }) => {
      calls.push(`resumeWorkflowExecution ${executionId}`);
      startRun(executionId);
      return { executionId };
    }),
    getWorkflowExecution: vi.fn(async ({ executionId }: { executionId: string }) => {
      calls.push(`getWorkflowExecution ${executionId}`);
      const spec = executions.get(executionId);
      if (!spec) throw new ConnectError("not found", Code.NotFound);
      if (executionId !== activeRunId) return { execution: toExecution(spec, spec.status) };
      if (options.pollFailure) throw options.pollFailure;
      const statuses = options.run?.statuses ?? [WorkflowExecution_Status.SUCCESS];
      const status = statuses[Math.min(polls, statuses.length - 1)]!;
      polls++;
      return { execution: toExecution(spec, status) };
    }),
    getFunctionExecution: vi.fn(async ({ executionId }: { executionId: string }) => {
      const job = functionExecutions.get(executionId);
      return {
        execution: {
          logEntries: (job?.logs ?? []).map((message) => ({ message })),
          error: job?.error ? { message: job.error } : undefined,
          result: job?.result ?? "",
        },
      };
    }),
    deleteWorkflow: vi.fn(async () => calls.push("deleteWorkflow")),
    deleteWorkflowJobFunction: vi.fn(async ({ jobFunctionName }: { jobFunctionName: string }) =>
      calls.push(`deleteWorkflowJobFunction ${jobFunctionName}`),
    ),
    deleteFunctionRegistry: vi.fn(async () => calls.push("deleteFunctionRegistry")),
  };

  return { client: raw as unknown as OperatorClient, raw, calls };
}

function run(
  client: OperatorClient,
  overrides: Partial<MigrationStepsWorkflowOptions> = {},
): ReturnType<typeof executeMigrationStepsAsWorkflow> {
  return executeMigrationStepsAsWorkflow({
    client,
    workspaceId: "ws-1",
    code: "// bundled steps",
    namespace: "tailordb",
    migrationNumber: 3,
    invoker,
    appName: "my-app",
    appId: "app-1",
    pollIntervalMs: 0,
    order: ORDER,
    onBeforeStart: vi.fn(async () => {}),
    onExecutionStarted: vi.fn(async () => {}),
    notify: (level, message) => logger[level](message),
    ...overrides,
  });
}

const ALL_STEPS_SUCCEEDED = [
  { status: WorkflowJobExecution_Status.SUCCESS },
  runnerJob(0, WorkflowJobExecution_Status.SUCCESS),
  runnerJob(1, WorkflowJobExecution_Status.SUCCESS),
  runnerJob(2, WorkflowJobExecution_Status.SUCCESS),
];

describe("executeMigrationStepsAsWorkflow", () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.info).mockClear();
    vi.mocked(writeMetadataLabelsDirect).mockClear();
  });

  test("starts an orchestrator and a step runner, and keeps them after success", async () => {
    const onExecutionStarted = vi.fn(async () => {});
    const { client, raw, calls } = createStepsClient({
      run: { statuses: [WorkflowExecution_Status.SUCCESS], jobs: ALL_STEPS_SUCCEEDED },
    });

    const result = await run(client, { onExecutionStarted });

    expect(result).toMatchObject({
      success: true,
      executionId: "exec-new",
      completedSteps: ORDER,
      failedSteps: [],
      stepsMayHaveCommitted: true,
    });
    expect(raw.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowName: NAME,
        mainJobFunctionName: NAME,
        jobFunctions: { [NAME]: 1n, [RUNNER]: 2n },
      }),
    );
    expect(raw.createWorkflowJobFunction).toHaveBeenCalledWith(
      expect.objectContaining({ jobFunctionName: RUNNER, scriptRef: NAME }),
    );
    expect(onExecutionStarted).toHaveBeenCalledWith("exec-new");
    expect(calls.indexOf("startWorkflow")).toBeGreaterThan(calls.indexOf("createWorkflow"));
    expect(calls.filter((call) => call.startsWith("delete")).length).toBeLessThanOrEqual(4);
    expect(calls.slice(calls.indexOf("startWorkflow"))).not.toContain("deleteWorkflow");
  });

  test("labels the workflow with the plan it runs", async () => {
    const { client } = createStepsClient({
      run: { statuses: [WorkflowExecution_Status.SUCCESS], jobs: ALL_STEPS_SUCCEEDED },
    });

    await run(client);

    const workflowLabel = vi
      .mocked(writeMetadataLabelsDirect)
      .mock.calls.map(([, write]) => write as { trn: string; metadata?: Record<string, string> })
      .find((write) => write.trn === `trn:v1:workspace:ws-1:workflow:${NAME}`);
    expect(workflowLabel?.metadata).toEqual({
      "sdk-migration-plan": migrationPlanFingerprint(ORDER),
    });
  });

  test("reports which steps committed when a later step fails, and keeps the run", async () => {
    const { client, calls } = createStepsClient({
      run: {
        statuses: [WorkflowExecution_Status.FAILED],
        jobs: [
          { status: WorkflowJobExecution_Status.FAILED },
          runnerJob(0, WorkflowJobExecution_Status.SUCCESS, ["backfilled 10 users"]),
          {
            ...runnerJob(1, WorkflowJobExecution_Status.FAILED),
            error: "column total does not exist",
          },
        ],
      },
    });

    const result = await run(client);

    expect(result).toMatchObject({
      success: false,
      completedSteps: ["backfillUser"],
      failedSteps: ["backfillInvoice"],
      stepsMayHaveCommitted: true,
      error: "column total does not exist",
    });
    expect(result.logs).toContain("[backfillUser] backfilled 10 users");
    expect(calls.slice(calls.indexOf("startWorkflow"))).not.toContain("deleteWorkflow");
  });

  test("reports the failed step's error rather than another step's result", async () => {
    const { client } = createStepsClient({
      run: {
        statuses: [WorkflowExecution_Status.FAILED],
        jobs: [
          { status: WorkflowJobExecution_Status.FAILED },
          {
            ...runnerJob(1, WorkflowJobExecution_Status.FAILED),
            error: "column total does not exist",
          },
          {
            ...runnerJob(0, WorkflowJobExecution_Status.SUCCESS),
            result: '{"step":"backfillUser"}',
          },
        ],
      },
    });

    const result = await run(client);

    expect(result).toMatchObject({ success: false, error: "column total does not exist" });
  });

  test("tears the run down when it fails before any step started", async () => {
    const { client, calls } = createStepsClient({
      run: {
        statuses: [WorkflowExecution_Status.FAILED],
        jobs: [{ status: WorkflowJobExecution_Status.FAILED, error: "bad bundle" }],
      },
    });

    const result = await run(client);

    expect(result).toMatchObject({
      success: false,
      stepsMayHaveCommitted: false,
      completedSteps: [],
    });
    expect(calls.slice(calls.indexOf("startWorkflow"))).toEqual(
      expect.arrayContaining([
        "deleteWorkflow",
        `deleteWorkflowJobFunction ${NAME}`,
        `deleteWorkflowJobFunction ${RUNNER}`,
        "deleteFunctionRegistry",
      ]),
    );
  });

  test.each([
    { name: "Unavailable", error: new ConnectError("lost", Code.Unavailable) },
    { name: "DeadlineExceeded", error: new ConnectError("lost", Code.DeadlineExceeded) },
    { name: "Internal", error: new ConnectError("lost", Code.Internal) },
    { name: "FailedPrecondition", error: new ConnectError("lost", Code.FailedPrecondition) },
    { name: "a dropped connection", error: new TypeError("fetch failed") },
  ])(
    "keeps the run when starting it fails with $name after the execution was created",
    async ({ error }) => {
      const onExecutionStarted = vi.fn(async () => {});
      const { client, calls } = createStepsClient({
        startFailure: { error, afterCreating: true },
      });

      await expect(run(client, { onExecutionStarted })).rejects.toMatchObject({
        code: "MIGRATION_START_UNCONFIRMED",
        message: expect.stringContaining("tailordb/0003"),
        cause: error,
      });
      expect(
        calls.slice(calls.indexOf("startWorkflow")).filter((call) => call.startsWith("delete")),
      ).toEqual([]);
      expect(onExecutionStarted).not.toHaveBeenCalled();
    },
  );

  test.each(
    [Code.InvalidArgument, Code.NotFound, Code.PermissionDenied, Code.Unauthenticated].map(
      (code) => ({ code, codeName: Code[code] }),
    ),
  )("tears the run down when the platform refuses to start it with $codeName", async ({ code }) => {
    const error = new ConnectError("refused", code);
    const { client, calls } = createStepsClient({
      startFailure: { error, afterCreating: false },
    });

    await expect(run(client)).rejects.toBe(error);
    expect(calls.slice(calls.indexOf("startWorkflow"))).toEqual(
      expect.arrayContaining([
        "deleteWorkflow",
        `deleteWorkflowJobFunction ${NAME}`,
        `deleteWorkflowJobFunction ${RUNNER}`,
        "deleteFunctionRegistry",
      ]),
    );
  });

  test("treats a run whose first step failed as nothing committed", async () => {
    const { client, calls } = createStepsClient({
      run: {
        statuses: [WorkflowExecution_Status.FAILED],
        jobs: [
          { status: WorkflowJobExecution_Status.FAILED },
          { ...runnerJob(0, WorkflowJobExecution_Status.FAILED), error: "first step broke" },
        ],
      },
    });

    const result = await run(client);

    expect(result).toMatchObject({
      success: false,
      stepsMayHaveCommitted: false,
      completedSteps: [],
      failedSteps: ["backfillUser"],
      error: "first step broke",
    });
    expect(calls.slice(calls.indexOf("startWorkflow"))).toContain("deleteWorkflow");
  });

  test("treats a lost connection to the run as possibly committed", async () => {
    const { client, calls } = createStepsClient({ pollFailure: new Error("network down") });

    const result = await run(client);

    expect(result).toMatchObject({
      success: false,
      stepsMayHaveCommitted: true,
      executionId: "exec-new",
    });
    expect(result.error).toContain("network down");
    expect(calls.slice(calls.indexOf("startWorkflow"))).not.toContain("deleteWorkflow");
  });

  test("keeps waiting while the run reports no status yet", async () => {
    const { client } = createStepsClient({
      run: {
        statuses: [WorkflowExecution_Status.UNSPECIFIED, WorkflowExecution_Status.SUCCESS],
        jobs: ALL_STEPS_SUCCEEDED,
      },
    });

    const result = await run(client);

    expect(result).toMatchObject({ success: true, completedSteps: ORDER });
  });

  test("keeps waiting while the run reports a status this SDK does not know", async () => {
    const { client } = createStepsClient({
      run: {
        statuses: [99 as WorkflowExecution_Status, WorkflowExecution_Status.SUCCESS],
        jobs: ALL_STEPS_SUCCEEDED,
      },
    });

    const result = await run(client);

    expect(result).toMatchObject({ success: true, completedSteps: ORDER });
  });

  test("keeps waiting through a transient error while polling the run", async () => {
    const { client, raw } = createStepsClient({
      run: { statuses: [WorkflowExecution_Status.SUCCESS], jobs: ALL_STEPS_SUCCEEDED },
    });
    raw.getWorkflowExecution.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable),
    );

    const result = await run(client);

    expect(result).toMatchObject({ success: true, completedSteps: ORDER });
  });

  test("reports progress on every poll that finds the run active", async () => {
    const { client, raw } = createStepsClient({
      run: {
        statuses: [
          WorkflowExecution_Status.RUNNING,
          WorkflowExecution_Status.RUNNING,
          WorkflowExecution_Status.SUCCESS,
        ],
        jobs: [
          { status: WorkflowJobExecution_Status.SUCCESS },
          runnerJob(0, WorkflowJobExecution_Status.SUCCESS),
        ],
      },
    });
    raw.getWorkflowExecution.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable),
    );
    const onProgress = vi.fn();

    await run(client, { onProgress });

    expect(onProgress.mock.calls).toEqual([
      [1, ORDER.length],
      [1, ORDER.length],
    ]);
  });

  test("treats a run that disappears while polling as possibly committed", async () => {
    const { client, raw } = createStepsClient({
      run: { statuses: [WorkflowExecution_Status.SUCCESS], jobs: ALL_STEPS_SUCCEEDED },
    });
    raw.getWorkflowExecution.mockResolvedValueOnce({ execution: undefined } as never);

    const result = await run(client);

    expect(result).toMatchObject({ success: false, stepsMayHaveCommitted: true });
    expect(result.error).toContain("Migration workflow execution 'exec-new' not found.");
  });

  test("treats a step that succeeded without a recorded position as possibly committed", async () => {
    const { client, calls } = createStepsClient({
      run: {
        statuses: [WorkflowExecution_Status.FAILED],
        jobs: [
          { status: WorkflowJobExecution_Status.FAILED },
          { name: RUNNER, status: WorkflowJobExecution_Status.SUCCESS },
          { ...runnerJob(1, WorkflowJobExecution_Status.FAILED), error: "boom" },
        ],
      },
    });

    const result = await run(client);

    expect(result).toMatchObject({ success: false, stepsMayHaveCommitted: true });
    expect(calls.slice(calls.indexOf("startWorkflow"))).not.toContain("deleteWorkflow");
  });

  test("refuses to reclaim leftovers while one of their executions is still active", async () => {
    const onBeforeStart = vi.fn(async () => {});
    const { client, raw } = createStepsClient({
      existingWorkflow: { id: "wf-old" },
      listed: [{ id: "exec-old", status: WorkflowExecution_Status.RUNNING }],
    });

    await expect(run(client, { onBeforeStart })).rejects.toMatchObject({
      code: "MIGRATION_EXECUTION_ACTIVE",
    });
    expect(raw.deleteWorkflow).not.toHaveBeenCalled();
    expect(raw.startWorkflow).not.toHaveBeenCalled();
    expect(onBeforeStart).not.toHaveBeenCalled();
  });

  test("calls onBeforeStart once no other execution is active and before starting a run", async () => {
    const { client, calls } = createStepsClient({
      run: { statuses: [WorkflowExecution_Status.SUCCESS], jobs: ALL_STEPS_SUCCEEDED },
    });
    const onBeforeStart = vi.fn(async () => {
      calls.push("onBeforeStart");
    });

    await run(client, { onBeforeStart });

    expect(onBeforeStart).toHaveBeenCalledOnce();
    expect(calls.indexOf("onBeforeStart")).toBeGreaterThan(calls.indexOf("listWorkflowExecutions"));
    expect(calls.indexOf("onBeforeStart")).toBeLessThan(calls.indexOf("startWorkflow"));
  });

  describe("when the migration is already in progress", () => {
    const failedRun: ExecutionSpec = {
      id: "exec-old",
      status: WorkflowExecution_Status.FAILED,
      jobs: [
        { status: WorkflowJobExecution_Status.FAILED },
        runnerJob(0, WorkflowJobExecution_Status.SUCCESS),
        runnerJob(1, WorkflowJobExecution_Status.FAILED),
      ],
    };

    test("resumes the failed run with the updated script when the plan is unchanged", async () => {
      const { client, raw, calls } = createStepsClient({
        existingWorkflow: { id: "wf-old", plan: migrationPlanFingerprint(ORDER) },
        listed: [failedRun],
        run: { statuses: [WorkflowExecution_Status.SUCCESS], jobs: ALL_STEPS_SUCCEEDED },
      });

      const result = await run(client, { inProgress: { executionId: "exec-old" } });

      expect(result).toMatchObject({ success: true, executionId: "exec-old" });
      expect(calls).toContain("updateFunctionRegistry");
      expect(calls.indexOf("updateFunctionRegistry")).toBeLessThan(
        calls.indexOf("resumeWorkflowExecution exec-old"),
      );
      expect(raw.createWorkflow).not.toHaveBeenCalled();
      expect(raw.startWorkflow).not.toHaveBeenCalled();
      expect(raw.deleteWorkflow).not.toHaveBeenCalled();
    });

    test("finds the run by name when its execution id was never recorded", async () => {
      const { client, raw } = createStepsClient({
        existingWorkflow: { id: "wf-old", plan: migrationPlanFingerprint(ORDER) },
        listed: [failedRun],
        run: { statuses: [WorkflowExecution_Status.SUCCESS], jobs: ALL_STEPS_SUCCEEDED },
      });

      await run(client, { inProgress: {} });

      expect(raw.resumeWorkflowExecution).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        executionId: "exec-old",
      });
    });

    test("runs every step again when the planned steps changed", async () => {
      const { client, raw, calls } = createStepsClient({
        existingWorkflow: { id: "wf-old", plan: migrationPlanFingerprint(["backfillUser"]) },
        listed: [failedRun],
        run: { statuses: [WorkflowExecution_Status.SUCCESS], jobs: ALL_STEPS_SUCCEEDED },
      });

      const result = await run(client, { inProgress: { executionId: "exec-old" } });

      expect(result.success).toBe(true);
      expect(raw.resumeWorkflowExecution).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("every step runs again"));
      expect(calls.indexOf("deleteWorkflow")).toBeLessThan(calls.indexOf("startWorkflow"));
    });

    test("runs every step again when the earlier run is gone", async () => {
      const { client, raw } = createStepsClient({
        run: { statuses: [WorkflowExecution_Status.SUCCESS], jobs: ALL_STEPS_SUCCEEDED },
      });

      const result = await run(client, { inProgress: { executionId: "exec-gone" } });

      expect(result.success).toBe(true);
      expect(raw.startWorkflow).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("every step runs again"));
    });

    test("reports through notify and calls onBeforeStart before running every step again", async () => {
      const { client, calls } = createStepsClient({
        run: { statuses: [WorkflowExecution_Status.SUCCESS], jobs: ALL_STEPS_SUCCEEDED },
      });
      const notify = vi.fn();
      const onBeforeStart = vi.fn(async () => {
        calls.push("onBeforeStart");
      });

      await run(client, { inProgress: { executionId: "exec-gone" }, notify, onBeforeStart });

      expect(notify).toHaveBeenCalledWith("warn", expect.stringContaining("every step runs again"));
      expect(logger.warn).not.toHaveBeenCalled();
      expect(onBeforeStart).toHaveBeenCalledOnce();
      expect(calls.indexOf("onBeforeStart")).toBeLessThan(calls.indexOf("startWorkflow"));
    });

    test("does not run the steps again when the earlier run already succeeded", async () => {
      const { client, raw } = createStepsClient({
        existingWorkflow: { id: "wf-old", plan: migrationPlanFingerprint(ORDER) },
        listed: [
          { id: "exec-old", status: WorkflowExecution_Status.SUCCESS, jobs: ALL_STEPS_SUCCEEDED },
        ],
      });

      const result = await run(client, { inProgress: { executionId: "exec-old" } });

      expect(result).toMatchObject({ success: true, completedSteps: ORDER });
      expect(raw.startWorkflow).not.toHaveBeenCalled();
      expect(raw.resumeWorkflowExecution).not.toHaveBeenCalled();
    });

    test("runs every step again when the steps changed after the earlier run succeeded", async () => {
      const { client, raw } = createStepsClient({
        existingWorkflow: { id: "wf-old", plan: migrationPlanFingerprint(["backfillUser"]) },
        listed: [
          { id: "exec-old", status: WorkflowExecution_Status.SUCCESS, jobs: ALL_STEPS_SUCCEEDED },
        ],
        run: { statuses: [WorkflowExecution_Status.SUCCESS], jobs: ALL_STEPS_SUCCEEDED },
      });

      const result = await run(client, { inProgress: { executionId: "exec-old" } });

      expect(result).toMatchObject({ success: true, executionId: "exec-new" });
      expect(raw.startWorkflow).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("every step runs again"));
    });

    test("waits for an earlier run that is still active instead of starting another", async () => {
      const { client, raw } = createStepsClient({
        existingWorkflow: { id: "wf-old", plan: migrationPlanFingerprint(ORDER) },
        listed: [{ id: "exec-old", status: WorkflowExecution_Status.RUNNING }],
      });
      raw.getWorkflowExecution.mockImplementationOnce(async () => ({
        execution: { id: "exec-old", status: WorkflowExecution_Status.RUNNING, jobExecutions: [] },
      }));
      raw.getWorkflowExecution.mockImplementationOnce(async () => ({
        execution: { id: "exec-old", status: WorkflowExecution_Status.RUNNING, jobExecutions: [] },
      }));
      raw.getWorkflowExecution.mockImplementationOnce(async () => ({
        execution: {
          id: "exec-old",
          status: WorkflowExecution_Status.SUCCESS,
          jobExecutions: [],
        },
      }));

      const result = await run(client, { inProgress: { executionId: "exec-old" } });

      expect(result.success).toBe(true);
      expect(raw.startWorkflow).not.toHaveBeenCalled();
      expect(raw.resumeWorkflowExecution).not.toHaveBeenCalled();
    });

    test.each([
      ["succeeds", WorkflowExecution_Status.SUCCESS],
      ["fails", WorkflowExecution_Status.FAILED],
    ])(
      "runs every step again when the steps changed and an earlier active run %s",
      async (_label, finalStatus) => {
        const { client, raw } = createStepsClient({
          existingWorkflow: { id: "wf-old", plan: migrationPlanFingerprint(["backfillUser"]) },
          listed: [{ id: "exec-old", status: finalStatus }],
          run: { statuses: [WorkflowExecution_Status.SUCCESS], jobs: ALL_STEPS_SUCCEEDED },
        });
        raw.getWorkflowExecution.mockImplementationOnce(async () => ({
          execution: {
            id: "exec-old",
            status: WorkflowExecution_Status.RUNNING,
            jobExecutions: [],
          },
        }));
        raw.getWorkflowExecution.mockImplementationOnce(async () => ({
          execution: { id: "exec-old", status: finalStatus, jobExecutions: [] },
        }));

        const result = await run(client, { inProgress: { executionId: "exec-old" } });

        expect(result).toMatchObject({ success: true, executionId: "exec-new" });
        expect(raw.startWorkflow).toHaveBeenCalledOnce();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("every step runs again"));
      },
    );
  });
});

describe("removeMigrationWorkflowResources", () => {
  test("removes the workflow, both job functions, and the function", async () => {
    const { client, calls } = createStepsClient({ existingWorkflow: { id: "wf-old" } });

    await removeMigrationWorkflowResources(client, "ws-1", "tailordb", 3);

    expect(calls).toEqual([
      "getWorkflowByName",
      "deleteWorkflow",
      `deleteWorkflowJobFunction ${NAME}`,
      `deleteWorkflowJobFunction ${RUNNER}`,
      "deleteFunctionRegistry",
    ]);
  });

  test("names the job function it could not remove", async () => {
    const { client, raw } = createStepsClient({ existingWorkflow: { id: "wf-old" } });
    raw.deleteWorkflowJobFunction.mockImplementation(async ({ jobFunctionName }) => {
      if (jobFunctionName === RUNNER) throw new ConnectError("denied", Code.PermissionDenied);
      return 0;
    });

    await removeMigrationWorkflowResources(client, "ws-1", "tailordb", 3);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`'${RUNNER}'`));
  });
});
