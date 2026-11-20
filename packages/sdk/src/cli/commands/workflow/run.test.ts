// oxlint-disable local/typed-operator-client-mock -- Untyped mocks; migrate them to mockOperatorClient() when editing them.
import * as fs from "node:fs";
import * as os from "node:os";
import { extractFields, runCommand as invoke } from "@politty/zod";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { commonArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadMachineUserName } from "#/cli/shared/context";
import { CLIError } from "#/cli/shared/errors";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import {
  awaitWorkflowRun,
  reclaimFinishedWorkflowRuns,
  startWorkflowRun,
} from "#/cli/shared/workflow-run";
import { bundleForRun } from "../function/bundle";
import { detectFunctionType } from "../function/detect";
import { assertJobSource, outcomeBundle, runCommand } from "./run";
import { bundleWorkflowRunJobs } from "./run-jobs";

vi.mock("#/cli/shared/config-loader", () => ({ loadConfig: vi.fn() }));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("12345678-1234-4abc-8def-123456789012"),
  loadMachineUserName: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("#/cli/shared/client", async (importActual) => ({
  ...(await importActual<object>()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/workflow-run", async (importActual) => ({
  ...(await importActual<object>()),
  startWorkflowRun: vi.fn(),
  awaitWorkflowRun: vi.fn(),
  reclaimFinishedWorkflowRuns: vi.fn(),
}));

vi.mock("./run-jobs", () => ({ bundleWorkflowRunJobs: vi.fn() }));

vi.mock("../function/detect", () => ({
  detectFunctionType: vi.fn(),
}));

vi.mock("../function/bundle", () => ({
  bundleForRun: vi.fn(),
}));

const WORKSPACE_ID = "12345678-1234-4abc-8def-123456789012";
const started = {
  runId: "r00abc-xyz",
  name: "tmp-run-r00abc-xyz",
  functionNames: ["tmp-run-r00abc-xyz"],
  workflowId: "wf-1",
  executionId: "exec-1",
};

describe("assertJobSource", () => {
  test("accepts a TypeScript source, which can export workflow jobs", () => {
    expect(() => assertJobSource({ filePath: "/p/jobs.ts", job: "greet" })).not.toThrow();
  });

  test("rejects --job for a pre-bundled file, which has no jobs to choose from", () => {
    expect(() => assertJobSource({ filePath: "/p/slow.js", job: "greet" })).toThrow(/pre-bundled/);
  });
});

describe("runCommand options", () => {
  test("take no short alias that a global option already owns, so -j still means --json", () => {
    const own = extractFields(runCommand.args).fields.flatMap((field) => field.alias ?? []);
    const global = extractFields(z.strictObject(commonArgs)).fields.flatMap(
      (field) => field.alias ?? [],
    );

    expect(own.filter((alias) => global.includes(alias))).toEqual([]);
  });
});

describe("workflow run", () => {
  let scriptPath: string;
  let exit: ReturnType<typeof vi.spyOn>;

  aroundEach(async (runTest) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-test-"));
    scriptPath = path.join(tmpDir, "jobs.ts");
    fs.writeFileSync(scriptPath, "export const greet = {};");

    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        path: path.join(tmpDir, "tailor.config.ts"),
        auth: { name: "auth", machineUsers: { admin: {} } },
      },
      plugins: [],
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    vi.mocked(loadMachineUserName).mockResolvedValue(undefined);
    vi.mocked(initOperatorClient).mockResolvedValue({
      getAuthMachineUser: vi.fn().mockResolvedValue({ machineUser: { id: "mu-1" } }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    vi.mocked(detectFunctionType).mockResolvedValue({
      type: "workflow-job",
      name: "greet",
      exportName: "greet",
    });
    vi.mocked(bundleWorkflowRunJobs).mockResolvedValue({
      mainJobName: "greet",
      jobs: [{ jobName: "greet", code: "// greet" }],
    });
    vi.mocked(bundleForRun).mockResolvedValue({
      bundledCode: "export const main = async () => ({});",
      scriptName: "backfill.js",
      sourceFiles: [],
    });
    vi.mocked(startWorkflowRun).mockReset().mockResolvedValue(started);
    vi.mocked(awaitWorkflowRun)
      .mockReset()
      .mockResolvedValue({
        state: "finished",
        result: { success: true, logs: "", result: '{"ok":true}' },
      });
    vi.mocked(reclaimFinishedWorkflowRuns)
      .mockReset()
      .mockResolvedValue({ removed: [], keptUnlabeled: [], removedUnlabeled: [] });
    vi.mocked(bundleForRun).mockClear();
    vi.mocked(detectFunctionType).mockClear();
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await runTest();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("asks for a file", async () => {
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await invoke(runCommand, ["--machine-user", "admin"]);

    expect(result.success).toBe(false);
  });

  test("warns about unlabeled tmp-run resources the sweep before the run left in place", async () => {
    vi.mocked(reclaimFinishedWorkflowRuns).mockResolvedValue({
      removed: [],
      keptUnlabeled: [{ kind: "function", name: "tmp-run-r1" }],
      removedUnlabeled: [],
    });
    using _stdout = captureStdout();
    using stderr = captureStderr();

    await invoke(runCommand, [scriptPath, "-m", "admin"]);

    expect(stderr.output).toContain("tailor workflow cleanup --include-unlabeled");
  });

  test("runs the only workflow job of the file with its argument and prints the result with the run ids", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await invoke(runCommand, [scriptPath, "--arg", '{"from":"2026-01-01"}', "-m", "admin"]);

    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        kind: "job",
        mainJobName: "greet",
        arg: { from: "2026-01-01" },
      }),
    );
    expect(reclaimFinishedWorkflowRuns).toHaveBeenCalledOnce();
    expect(JSON.parse(stdout.output)).toMatchObject({
      success: true,
      runId: started.runId,
      executionId: started.executionId,
    });
    expect(exit).not.toHaveBeenCalled();
  });

  test("registers the jobs the selected job starts, and never bundles the file as a script", async () => {
    vi.mocked(bundleWorkflowRunJobs).mockResolvedValue({
      mainJobName: "greet",
      jobs: [
        { jobName: "greet", code: "// greet" },
        { jobName: "wave", code: "// wave" },
      ],
    });
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await invoke(runCommand, [scriptPath, "--job", "greet", "-m", "admin"]);

    expect(detectFunctionType).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: "greet", jobFlag: "--job" }),
    );
    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "job",
        mainJobName: "greet",
        jobs: [
          { jobName: "greet", code: "// greet" },
          { jobName: "wave", code: "// wave" },
        ],
      }),
    );
    expect(bundleForRun).not.toHaveBeenCalled();
  });

  test.each([
    { type: "plain" as const, name: "backfill" },
    { type: "resolver" as const, name: "sum" },
    { type: "executor" as const, name: "on-create" },
  ])(
    "refuses a $type file, which defines no workflow, before creating anything",
    async (detected) => {
      vi.mocked(detectFunctionType).mockResolvedValue(detected);
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      const result = await invoke(runCommand, [scriptPath, "-m", "admin"]);

      expect(result.error).toMatchObject({ code: "WORKFLOW_RUN_WORKFLOW_REQUIRED" });
      expect(bundleWorkflowRunJobs).not.toHaveBeenCalled();
      expect(startWorkflowRun).not.toHaveBeenCalled();
    },
  );

  test("exits 1 and still prints the result of a job that failed", async () => {
    vi.mocked(awaitWorkflowRun).mockResolvedValue({
      state: "finished",
      result: { success: false, logs: "about to fail", result: "", error: "boom" },
    });
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await invoke(runCommand, [scriptPath, "-m", "admin"]);

    expect(JSON.parse(stdout.output)).toMatchObject({ success: false, error: "boom" });
    expect(exit).toHaveBeenCalledWith(1);
  });

  test("tells how to read the run and clean up when the wait times out", async () => {
    vi.mocked(awaitWorkflowRun).mockResolvedValue({ state: "timedOut" });
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await invoke(runCommand, [scriptPath, "-m", "admin"]);

    expect(result.error).toMatchObject({
      code: "WORKFLOW_RUN_WAIT_TIMEOUT",
      suggestion: expect.stringContaining(`tailor workflow executions ${started.executionId}`),
    });
    expect(result.error).toMatchObject({ suggestion: expect.stringContaining(WORKSPACE_ID) });
    expect(result.error).toMatchObject({
      suggestion: expect.stringContaining("tailor workflow cleanup"),
    });
  });

  test("tells how to read the result, with its logs, when a finished run cannot be read", async () => {
    vi.mocked(awaitWorkflowRun).mockResolvedValue({
      state: "outcomeUnavailable",
      reason: "the job result is missing",
      workflowRemoved: false,
    });
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await invoke(runCommand, [scriptPath, "-m", "admin"]);

    expect(result.error).toMatchObject({
      code: "WORKFLOW_RUN_OUTCOME_UNAVAILABLE",
      suggestion: expect.stringContaining("--logs"),
    });
    expect(result.error).toMatchObject({
      suggestion: expect.stringContaining("tailor workflow cleanup"),
    });
  });

  test("says the jobs run to their end, and does not send to the workflow, when it was removed", async () => {
    vi.mocked(awaitWorkflowRun).mockResolvedValue({
      state: "outcomeUnavailable",
      reason: "the workflow was removed before the job of the run was seen",
      workflowRemoved: true,
    });
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await invoke(runCommand, [scriptPath, "-m", "admin"]);

    expect(result.error).toMatchObject({
      code: "WORKFLOW_RUN_OUTCOME_UNAVAILABLE",
      message: expect.stringContaining("removed"),
      suggestion: expect.stringContaining("run to their end"),
    });
    expect(result.error).not.toMatchObject({
      suggestion: expect.stringContaining("workflow executions"),
    });
  });

  test.each([
    { description: "a number", arg: "5" },
    { description: "an array", arg: "[1]" },
  ])(
    "refuses $description as the argument before bundling or creating anything",
    async ({ arg }) => {
      using _stdout = captureStdout();
      using _stderr = captureStderr();
      using _json = jsonMode();

      const result = await invoke(runCommand, [scriptPath, "--arg", arg, "-m", "admin"]);

      expect(result.error).toMatchObject({ code: "WORKFLOW_RUN_ARG_NOT_OBJECT" });
      expect(bundleForRun).not.toHaveBeenCalled();
      expect(startWorkflowRun).not.toHaveBeenCalled();
    },
  );

  test("refuses a poll interval longer than the finished run is kept, before creating anything", async () => {
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await invoke(runCommand, [scriptPath, "--interval", "2m", "-m", "admin"]);

    expect(result.error).toMatchObject({ code: "WORKFLOW_RUN_INTERVAL_TOO_LONG" });
    expect(startWorkflowRun).not.toHaveBeenCalled();
  });

  test("asks detection to name --job, not --name, when the file holds several jobs", async () => {
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await invoke(runCommand, [scriptPath, "-m", "admin"]);

    expect(detectFunctionType).toHaveBeenCalledWith(expect.objectContaining({ jobFlag: "--job" }));
  });

  test("refuses --job when the file has no such job, before creating anything", async () => {
    vi.mocked(bundleWorkflowRunJobs).mockRejectedValue(
      CLIError({ code: "WORKFLOW_RUN_JOB_NOT_FOUND", message: "Workflow job not found." }),
    );
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await invoke(runCommand, [scriptPath, "--job", "missing", "-m", "admin"]);

    expect(result.error).toMatchObject({ code: "WORKFLOW_RUN_JOB_NOT_FOUND" });
    expect(startWorkflowRun).not.toHaveBeenCalled();
  });

  test("points an invalid --arg at workflow run, not at function run", async () => {
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await invoke(runCommand, [scriptPath, "--arg", "not json", "-m", "admin"]);

    expect(result.error).toMatchObject({
      code: "WORKFLOW_RUN_ARG_INVALID",
      command: "workflow run",
    });
  });

  test("points an unreadable argument file at workflow run too", async () => {
    const dir = path.dirname(scriptPath);
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await invoke(runCommand, [scriptPath, "--arg-file", dir, "-m", "admin"]);

    expect(result.error).toMatchObject({
      code: "WORKFLOW_RUN_ARG_FILE_UNREADABLE",
      command: "workflow run",
    });
  });
});

describe("outcomeBundle", () => {
  const source = {
    kind: "job" as const,
    mainJobName: "parent-job",
    jobs: [
      { jobName: "parent-job", code: "// parent bundle" },
      { jobName: "child-job", code: "// child bundle" },
    ],
  };

  test("is the bundle of the job the outcome was read from, so a child's stack maps through the child's sourcemap", () => {
    expect(
      outcomeBundle({
        source,
        runId: "r1",
        jobFunctionName: "tmp-run-r1-child-job",
        fallback: "// main",
      }),
    ).toBe("// child bundle");
  });

  test("falls back to the main bundle when the job is not one the run registered", () => {
    expect(
      outcomeBundle({ source, runId: "r1", jobFunctionName: "other", fallback: "// main" }),
    ).toBe("// main");
  });
});
