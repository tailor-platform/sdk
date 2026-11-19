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
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import {
  awaitWorkflowRun,
  reclaimFinishedWorkflowRuns,
  reclaimWorkflowRuns,
  startWorkflowRun,
} from "#/cli/shared/workflow-run";
import { bundleForRun } from "../function/bundle";
import { detectFunctionType } from "../function/detect";
import { checkScriptSchemaSnapshot } from "../function/script-scaffold";
import { assertSelectedJob, runCommand } from "./run";

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
  reclaimWorkflowRuns: vi.fn(),
  reclaimFinishedWorkflowRuns: vi.fn(),
}));

vi.mock("../function/detect", () => ({
  detectFunctionType: vi.fn(),
}));

vi.mock("../function/bundle", () => ({
  bundleForRun: vi.fn(),
}));

vi.mock("../function/script-scaffold", async (importActual) => ({
  ...(await importActual<object>()),
  checkScriptSchemaSnapshot: vi.fn(),
}));

const WORKSPACE_ID = "12345678-1234-4abc-8def-123456789012";
const started = {
  runId: "r00abc-xyz",
  name: "tmp-r00abc-xyz",
  workflowId: "wf-1",
  executionId: "exec-1",
};

describe("assertSelectedJob", () => {
  test("accepts the workflow job that was asked for", () => {
    expect(() =>
      assertSelectedJob({ job: "greet", functionType: "workflow-job", functionName: "greet" }),
    ).not.toThrow();
  });

  test("accepts a run without --job whatever the file holds", () => {
    expect(() =>
      assertSelectedJob({ job: undefined, functionType: "plain", functionName: "slow" }),
    ).not.toThrow();
  });

  test("rejects --job when the file exports no workflow jobs and would run its main", () => {
    expect(() =>
      assertSelectedJob({ job: "missing", functionType: "plain", functionName: "slow" }),
    ).toThrow(/WORKFLOW_RUN_JOB_NOT_FOUND|Workflow job "missing"/);
  });

  test("rejects --job when a resolver was detected first", () => {
    expect(() =>
      assertSelectedJob({ job: "greet", functionType: "resolver", functionName: "add" }),
    ).toThrow(/Workflow job "greet"/);
  });

  test("rejects --job for a pre-bundled file, which has no jobs to choose from", () => {
    expect(() =>
      assertSelectedJob({ job: "greet", functionType: undefined, functionName: undefined }),
    ).toThrow(/pre-bundled|\.ts/);
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
    scriptPath = path.join(tmpDir, "backfill.ts");
    fs.writeFileSync(scriptPath, "export async function main() { return { ok: true }; }");

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
    vi.mocked(detectFunctionType).mockResolvedValue({ type: "plain", name: "backfill" });
    vi.mocked(bundleForRun).mockResolvedValue({
      bundledCode: "export const main = async () => ({});",
      scriptName: "backfill.js",
      sourceFiles: [],
    });
    vi.mocked(checkScriptSchemaSnapshot).mockReset();
    vi.mocked(startWorkflowRun).mockReset().mockResolvedValue(started);
    vi.mocked(awaitWorkflowRun)
      .mockReset()
      .mockResolvedValue({
        state: "finished",
        result: { success: true, logs: "", result: '{"ok":true}' },
      });
    vi.mocked(reclaimWorkflowRuns).mockReset().mockResolvedValue([]);
    vi.mocked(reclaimFinishedWorkflowRuns).mockReset().mockResolvedValue(0);
    vi.mocked(bundleForRun).mockClear();
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await runTest();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("asks for a script file unless it is only cleaning up", async () => {
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await invoke(runCommand, ["--machine-user", "admin"]);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "WORKFLOW_RUN_FILE_REQUIRED" });
  });

  test("--cleanup removes finished runs at once and lists them", async () => {
    vi.mocked(reclaimWorkflowRuns).mockResolvedValue(["tmp-r1", "tmp-r2"]);
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await invoke(runCommand, ["--cleanup"]);

    expect(reclaimWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_ID, ignoreFinishedGrace: true }),
    );
    expect(JSON.parse(stdout.output)).toEqual({ removed: ["tmp-r1", "tmp-r2"] });
    expect(startWorkflowRun).not.toHaveBeenCalled();
  });

  test("runs the script once with its argument and prints the result with the run ids", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await invoke(runCommand, [scriptPath, "--arg", '{"from":"2026-01-01"}', "-m", "admin"]);

    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        kind: "script",
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

  test("labels a --job run as a job run", async () => {
    vi.mocked(detectFunctionType).mockResolvedValue({
      type: "workflow-job",
      name: "greet",
      exportName: "greet",
    });
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await invoke(runCommand, [scriptPath, "--job", "greet", "-m", "admin"]);

    expect(startWorkflowRun).toHaveBeenCalledWith(expect.objectContaining({ kind: "job" }));
  });

  test("exits 1 and still prints the result of a script that failed", async () => {
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
      suggestion: expect.stringContaining("workflow run --cleanup"),
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
      suggestion: expect.stringContaining("workflow run --cleanup"),
    });
  });

  test("says the script runs to its end, and does not send to the workflow, when it was removed", async () => {
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
      suggestion: expect.stringContaining("runs to its end"),
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

  test("refuses --job when the file has no such job, before creating anything", async () => {
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await invoke(runCommand, [scriptPath, "--job", "missing", "-m", "admin"]);

    expect(result.error).toMatchObject({ code: "WORKFLOW_RUN_JOB_NOT_FOUND" });
    expect(startWorkflowRun).not.toHaveBeenCalled();
  });

  test("checks the schema snapshot of the script as a workflow run, and passes the override on", async () => {
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await invoke(runCommand, [scriptPath, "--allow-schema-drift", "-m", "admin"]);

    expect(checkScriptSchemaSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: scriptPath,
        allowDrift: true,
        runCommand: ["workflow", "run"],
      }),
    );
  });

  test("does not create anything when the schema snapshot check refuses", async () => {
    vi.mocked(checkScriptSchemaSnapshot).mockRejectedValueOnce(new Error("Schema drift detected"));
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    const result = await invoke(runCommand, [scriptPath, "-m", "admin"]);

    expect(result.error?.message).toMatch(/Schema drift detected/);
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
