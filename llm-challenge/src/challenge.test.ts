import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { parseRunArgs, parseRunCommand } from "./args";
import { classifySolverFailure, writeArtifactSummary } from "./artifact-summary";
import { createRerunPlan, inheritSolverSettings } from "./cli";
import { discoverProblems, selectProblems } from "./problems";
import { runCommand } from "./process";
import { applyNoDocsProfile, stripJsDocBlocks } from "./profile";
import { buildRunArtifactPaths, createRunReport, reportPath, writeReport } from "./report";
import {
  CONTAINER_PNPM_STORE,
  DEFAULT_CODEX_IMAGE,
  DEFAULT_CODEX_NPM_PACKAGE,
  PNPM_STORE_ENV,
  buildCodexBootstrapScript,
  buildCodexExecArgs,
  buildCodexPreflightScript,
} from "./runner";
import { writeVerificationSummary } from "./verification";
import { prepareWorkspace, profileForProblem, pruneWorkspaceDeps } from "./workspace";
import type { Problem, StoredChallengeReport } from "./types";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = path.join(packageRoot, "src", "fixtures");
const tempDirs: string[] = [];

aroundEach(async (runTest) => {
  await runTest();
  vi.unstubAllEnvs();
  const dirs = [...tempDirs];
  tempDirs.length = 0;
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("argument parsing", () => {
  test("parses run defaults", () => {
    expect(parseRunCommand(["run"])).toMatchObject({
      agent: "claude",
      sdkRef: "HEAD",
      profile: "no-docs",
      profileExplicit: false,
      group: "all",
      model: "claude-opus-5-5",
      effort: "xhigh",
      runs: 3,
      concurrency: 1,
      maxSeconds: 1800,
      preflight: true,
      pruneWorkspaceDeps: true,
      problemFilters: [],
    });
  });

  test("resolves model and effort defaults from the selected agent", () => {
    expect(parseRunArgs(["--agent", "codex"])).toMatchObject({
      agent: "codex",
      model: "gpt-5.5",
      effort: "xhigh",
    });
    expect(parseRunArgs(["--model", "claude-sonnet-5-5", "--agent=claude"])).toMatchObject({
      agent: "claude",
      model: "claude-sonnet-5-5",
      modelExplicit: true,
      effortExplicit: false,
    });
    expect(() => parseRunArgs(["--agent", "gemini"])).toThrow("Unknown agent: gemini");
  });

  test("allows implicit profile with cli group", () => {
    expect(parseRunArgs(["--group", "cli"]).profileExplicit).toBe(false);
  });

  test("rejects explicit profile with cli group", () => {
    expect(() => parseRunArgs(["--group", "cli", "--profile", "full"])).toThrow(
      "--profile cannot be used with --group cli",
    );
  });

  test("parses repeated and comma-separated problem filters", () => {
    expect(
      parseRunArgs([
        "--profile=full",
        "--problem",
        "plugin-registration",
        "--problems",
        "cli/generate,resolver-context",
      ]),
    ).toMatchObject({
      profile: "full",
      profileExplicit: true,
      problemFilters: ["plugin-registration", "cli/generate", "resolver-context"],
    });
  });

  test("parses runner workflow options", () => {
    expect(
      parseRunArgs([
        "--no-preflight",
        "--no-prune-workspace-deps",
        "--rerun-nonzero-from",
        "results/run/report.json",
      ]),
    ).toMatchObject({
      preflight: false,
      pruneWorkspaceDeps: false,
      rerunNonzeroFrom: "results/run/report.json",
    });
    expect(() => parseRunArgs(["--no-preflight=true"])).toThrow(
      "--no-preflight does not accept a value",
    );
  });

  test("rejects an empty comma-separated problem filter", () => {
    expect(() => parseRunArgs(["--problems", ""])).toThrow(
      "--problems must contain at least one problem",
    );
    expect(() => parseRunArgs(["--problems=, ,"])).toThrow(
      "--problems must contain at least one problem",
    );
  });
});

describe("rerun plan", () => {
  async function writeSourceReport(report: Partial<StoredChallengeReport>): Promise<string> {
    const reportFilePath = path.join(await makeTempDir(), "report.json");
    await fs.writeFile(reportFilePath, JSON.stringify({ runId: "source", ...report }));
    return reportFilePath;
  }

  test("reruns failed runs and runs that never started before a stop", async () => {
    const problems = await discoverProblems(packageRoot);
    const [problem] = problems;
    const run = (runIndex: number, solverExitCode: number, failureKind: string) => ({
      problemId: problem.id,
      group: problem.group,
      runIndex,
      artifactDir: `results/source/run-${runIndex}`,
      solverExitCode,
      failureKind,
    });
    const reportFilePath = await writeSourceReport({
      runsPerProblem: 3,
      problems: [problem],
      runs: [run(0, 0, "none"), run(1, 1, "usage-limit")] as StoredChallengeReport["runs"],
    });

    const plan = await createRerunPlan({
      packageRoot,
      reportFilePath,
      allProblems: problems,
      selectedProblems: [problem],
    });

    expect(plan.tasks.map((task) => [task.runIndex, task.replaces?.artifactDir])).toEqual([
      [1, "results/source/run-1"],
      [2, undefined],
    ]);
    expect(plan.reportRerunOf.runs.map((rerun) => rerun.runIndex)).toEqual([1, 2]);
  });

  test("reruns only runs that were not scored", async () => {
    const problems = await discoverProblems(packageRoot);
    const [problem] = problems;
    const run = (runIndex: number, solverExitCode: number, failureKind?: string) => ({
      problemId: problem.id,
      group: problem.group,
      runIndex,
      artifactDir: `results/source/run-${runIndex}`,
      solverExitCode,
      timedOut: failureKind === "timeout",
      failureKind,
    });
    const reportFilePath = await writeSourceReport({
      runsPerProblem: 6,
      problems: [problem],
      runs: [
        run(0, 1, "solver-nonzero"),
        run(1, 0, "solver-nonzero"),
        run(2, 0, "model-mismatch"),
        run(3, 1, "api-error"),
        run(4, 1),
        run(5, 143, "timeout"),
      ] as StoredChallengeReport["runs"],
    });

    const plan = await createRerunPlan({
      packageRoot,
      reportFilePath,
      allProblems: problems,
      selectedProblems: [problem],
    });

    expect(plan.tasks.map((task) => task.runIndex)).toEqual([2, 3, 4, 5]);
  });

  test("resumes a stopped rerun against the runs it was replacing", async () => {
    const problems = await discoverProblems(packageRoot);
    const [problem] = problems;
    const original = (runIndex: number) => ({
      problemId: problem.id,
      group: problem.group,
      runIndex,
      artifactDir: `results/original/run-${runIndex}`,
      solverExitCode: 1,
    });
    const reportFilePath = await writeSourceReport({
      runsPerProblem: 3,
      problems: [problem],
      rerunOf: {
        sourceReportPath: "results/original/report.json",
        runs: [original(1), original(2)],
      },
      runs: [
        {
          problemId: problem.id,
          group: problem.group,
          runIndex: 1,
          artifactDir: "results/source/run-1",
          solverExitCode: 0,
          failureKind: "none",
        },
      ] as StoredChallengeReport["runs"],
    });

    const plan = await createRerunPlan({
      packageRoot,
      reportFilePath,
      allProblems: problems,
      selectedProblems: [problem],
    });

    expect(plan.tasks.map((task) => [task.runIndex, task.replaces?.artifactDir])).toEqual([
      [2, "results/original/run-2"],
    ]);
  });

  test("inherits the source solver settings and rejects conflicting overrides", () => {
    const source = { model: "gpt-5.5", effort: "xhigh" } as StoredChallengeReport;

    expect(inheritSolverSettings(parseRunArgs([]), source)).toEqual({
      agent: "codex",
      model: "gpt-5.5",
      effort: "xhigh",
    });
    expect(() => inheritSolverSettings(parseRunArgs(["--agent", "claude"]), source)).toThrow(
      "remove --agent claude",
    );
  });
});

describe("problem discovery", () => {
  test("discovers the initial problem set from group directories", async () => {
    const problems = await discoverProblems(packageRoot);

    expect(problems).toHaveLength(22);
    expect(problems.filter((problem) => problem.group === "sdk-api")).toHaveLength(18);
    expect(problems.filter((problem) => problem.group === "cli")).toHaveLength(4);
    expect(problems.map((problem) => problem.id)).toContain("plugin-registration");
    expect(problems.map((problem) => problem.id)).toContain("tailordb-profile-assets");
    expect(problems.map((problem) => problem.id)).toContain("tailordb-array-unique-recovery");
    expect(problems.every((problem) => problem.verifyPath !== undefined)).toBe(true);
    expect(
      problems.every((problem) => problem.sourcePath === `problems/${problem.group}/${problem.id}`),
    ).toBe(true);
  });

  test("selects problems by bare id and group-qualified id", async () => {
    const problems = await discoverProblems(packageRoot);

    expect(
      selectProblems(problems, "all", ["plugin-registration", "cli/generate"]).map(
        (problem) => problem.id,
      ),
    ).toEqual(["plugin-registration", "generate"]);
  });
});

describe("profile filtering", () => {
  test("removes docs entries and declaration JSDoc", async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, "docs"), { recursive: true });
    await fs.mkdir(path.join(dir, "dist"), { recursive: true });
    await fs.writeFile(path.join(dir, "README.md"), "docs");
    await fs.writeFile(path.join(dir, "CHANGELOG.md"), "changes");
    await fs.writeFile(path.join(dir, "docs/reference.md"), "reference");
    await fs.writeFile(
      path.join(dir, "dist/index.mjs"),
      "/** runtime docs */\nexport const value = '/** keep string */';\n/* keep regular block */\n",
    );
    await fs.writeFile(
      path.join(dir, "dist/index.mjs.map"),
      JSON.stringify({ sourcesContent: ["/** hidden docs */\nexport {};\n"] }),
    );
    await fs.writeFile(
      path.join(dir, "dist/index.d.ts"),
      "/** public docs */\nexport declare const value: string;\n/* keep */\nexport declare const other: string;\n",
    );

    await applyNoDocsProfile(dir);

    await expect(fs.access(path.join(dir, "README.md"))).rejects.toThrow("ENOENT");
    await expect(fs.access(path.join(dir, "CHANGELOG.md"))).rejects.toThrow("ENOENT");
    await expect(fs.access(path.join(dir, "docs"))).rejects.toThrow("ENOENT");
    await expect(fs.access(path.join(dir, "dist/index.mjs.map"))).rejects.toThrow("ENOENT");
    await expect(fs.readFile(path.join(dir, "dist/index.mjs"), "utf8")).resolves.not.toContain(
      "runtime docs",
    );
    await expect(fs.readFile(path.join(dir, "dist/index.mjs"), "utf8")).resolves.toContain(
      "'/** keep string */'",
    );
    await expect(fs.readFile(path.join(dir, "dist/index.mjs"), "utf8")).resolves.toContain(
      "/* keep regular block */",
    );
    await expect(fs.readFile(path.join(dir, "dist/index.d.ts"), "utf8")).resolves.toBe(
      "\nexport declare const value: string;\n/* keep */\nexport declare const other: string;\n",
    );
  });

  test("strips only JSDoc blocks from declaration text", () => {
    expect(stripJsDocBlocks("/** remove */\nexport type A = string;\n/* keep */\n")).toBe(
      "\nexport type A = string;\n/* keep */\n",
    );
  });

  test("strips JSDoc blocks without corrupting string literals", () => {
    expect(
      stripJsDocBlocks(
        [
          "const quoted = '/** keep quoted */';",
          "const templated = `/** keep templated */`;",
          "// /** keep line comment */",
          "/** remove docs */",
          "export const value = 1;",
        ].join("\n"),
      ),
    ).toBe(
      [
        "const quoted = '/** keep quoted */';",
        "const templated = `/** keep templated */`;",
        "// /** keep line comment */",
        "",
        "export const value = 1;",
      ].join("\n"),
    );
  });
});

describe("process command", () => {
  test("merges explicit environment values with the parent environment", async () => {
    expect(process.env.PATH).toBeDefined();
    const script = [
      "const pathStatus = process.env.PATH === process.env.PARENT_PATH ? 'inherited' : 'missing';",
      "process.stdout.write(`${process.env.LLM_CHALLENGE_TEST_ENV}\\n${pathStatus}`);",
    ].join("\n");

    const result = await runCommand(process.execPath, ["-e", script], {
      env: {
        LLM_CHALLENGE_TEST_ENV: "ok",
        PARENT_PATH: process.env.PATH,
      },
    });

    expect(result.stdout).toBe("ok\ninherited");
  });
});

describe("report and artifact paths", () => {
  test("builds the required run artifact layout", () => {
    const paths = buildRunArtifactPaths(
      "/tmp/out",
      { group: "sdk-api", id: "plugin-registration" },
      2,
    );

    expect(paths).toEqual({
      artifactDir: "/tmp/out/sdk-api/plugin-registration/run-2",
      promptPath: "/tmp/out/sdk-api/plugin-registration/run-2/prompt.md",
      solverStdoutPath: "/tmp/out/sdk-api/plugin-registration/run-2/solver.stdout.log",
      solverStderrPath: "/tmp/out/sdk-api/plugin-registration/run-2/solver.stderr.log",
      tracePath: "/tmp/out/sdk-api/plugin-registration/run-2/trace.jsonl",
      worktreePath: "/tmp/out/sdk-api/plugin-registration/run-2/work",
      artifactSummaryPath: "/tmp/out/sdk-api/plugin-registration/run-2/artifact-summary.json",
      verificationSummaryPath:
        "/tmp/out/sdk-api/plugin-registration/run-2/verification-summary.json",
      verificationStdoutPath: "/tmp/out/sdk-api/plugin-registration/run-2/verification.stdout.log",
      verificationStderrPath: "/tmp/out/sdk-api/plugin-registration/run-2/verification.stderr.log",
    });
  });

  test("writes report paths relative to llm-challenge", async () => {
    const dir = await makeTempDir();
    const reportFile = path.join(dir, "report.json");
    const problem = makeProblem();
    const paths = buildRunArtifactPaths(path.join(packageRoot, "results/run"), problem, 0);
    const run = createRunReport({
      packageRoot,
      problem,
      profile: "no-docs",
      runIndex: 0,
      paths,
      solverExitCode: 0,
      durationMs: 12,
      timedOut: false,
    });

    await writeReport(reportFile, {
      schemaVersion: 2,
      runId: "run",
      timestamp: "2026-05-24T00:00:00.000Z",
      agent: "claude",
      sdkRef: "abc123",
      requestedProfile: "no-docs",
      model: "claude-opus-5-5",
      effort: "xhigh",
      runsPerProblem: 1,
      problems: [],
      runs: [run],
    });

    const written = JSON.parse(await fs.readFile(reportFile, "utf8")) as {
      runs: Array<{
        artifactDir: string;
        artifactSummaryPath: string;
        verificationSummaryPath: string;
      }>;
    };
    expect(written.runs[0].artifactDir).toBe("results/run/sdk-api/example/run-0");
    expect(written.runs[0].artifactSummaryPath).toBe(
      "results/run/sdk-api/example/run-0/artifact-summary.json",
    );
    expect(written.runs[0].verificationSummaryPath).toBe(
      "results/run/sdk-api/example/run-0/verification-summary.json",
    );
    expect(reportPath(packageRoot, path.join(packageRoot, "results/run/report.json"))).toBe(
      "results/run/report.json",
    );
  });
});

describe("artifact summary", () => {
  test("indexes useful solver artifacts without cache-heavy directories", async () => {
    const dir = await makeTempDir();
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(path.join(worktreePath, "src"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, "node_modules/pkg"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, ".pnpm-home/store"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, ".tailor/cache"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, ".turbo/cache"), { recursive: true });
    await fs.writeFile(path.join(worktreePath, "src/app.ts"), "export {};\n");
    await fs.writeFile(path.join(worktreePath, "node_modules/pkg/index.js"), "");
    await fs.writeFile(path.join(worktreePath, ".pnpm-home/store/index.db"), "");
    await fs.writeFile(path.join(worktreePath, ".tailor/cache/generated.json"), "{}");
    await fs.writeFile(path.join(worktreePath, ".turbo/cache/state.json"), "{}");
    await runCommand("git", ["init"], { cwd: worktreePath });

    const tracePath = path.join(dir, "trace.jsonl");
    const solverStdoutPath = path.join(dir, "solver.stdout.log");
    const solverStderrPath = path.join(dir, "solver.stderr.log");
    const artifactSummaryPath = path.join(dir, "artifact-summary.json");
    await fs.writeFile(
      tracePath,
      [
        JSON.stringify({
          item: {
            type: "command_execution",
            command: "pnpm test",
            status: "in_progress",
          },
        }),
        JSON.stringify({
          item: {
            type: "command_execution",
            command: "pnpm test",
            exit_code: 0,
            status: "completed",
          },
        }),
        JSON.stringify({
          item: {
            type: "command_execution",
            command: "pnpm build",
            exit_code: 1,
            status: "failed",
            aggregated_output: "x".repeat(1_200),
          },
        }),
        JSON.stringify({
          type: "exec_command_end",
          command: "pnpm lint",
          exit_code: 2,
          aggregated_output: "y".repeat(1_200),
        }),
        JSON.stringify({ type: "error", message: "solver error" }),
      ].join("\n"),
    );
    await fs.writeFile(solverStdoutPath, "");
    await fs.writeFile(solverStderrPath, "");

    await writeArtifactSummary({
      problem: makeProblem(),
      runIndex: 0,
      worktreePath,
      tracePath,
      solverStdoutPath,
      solverStderrPath,
      artifactSummaryPath,
      agent: "codex",
      solverExitCode: 1,
      timedOut: false,
      failureKind: "solver-nonzero",
    });

    const summary = JSON.parse(await fs.readFile(artifactSummaryPath, "utf8")) as {
      files: string[];
      gitStatus: string[];
      commands: Array<{ command: string }>;
      failedCommands: Array<{ command: string; outputTail: string }>;
      errors: string[];
    };
    expect(summary.files).toContain("src/app.ts");
    expect(summary.files).not.toContain("node_modules/pkg/index.js");
    expect(summary.files).not.toContain(".pnpm-home/store/index.db");
    expect(summary.files).not.toContain(".tailor/cache/generated.json");
    expect(summary.files).not.toContain(".turbo/cache/state.json");
    expect(summary.gitStatus).toContain("?? src/app.ts");
    expect(summary.commands.map((command) => command.command)).toEqual([
      "pnpm test",
      "pnpm build",
      "pnpm lint",
    ]);
    expect(summary.failedCommands).toHaveLength(2);
    expect(summary.failedCommands[0].command).toBe("pnpm build");
    expect(summary.failedCommands[0].outputTail).toHaveLength(1_000);
    expect(summary.failedCommands[1].command).toBe("pnpm lint");
    expect(summary.failedCommands[1].outputTail).toHaveLength(1_000);
    expect(summary.errors).toEqual(["solver error"]);
  });

  test("classifies timeout, successful, usage-limit, and runner-startup failures", async () => {
    const dir = await makeTempDir();
    const tracePath = path.join(dir, "trace.jsonl");
    const solverStdoutPath = path.join(dir, "solver.stdout.log");
    const solverStderrPath = path.join(dir, "solver.stderr.log");
    await fs.writeFile(tracePath, "");
    await fs.writeFile(solverStdoutPath, "");
    await fs.writeFile(solverStderrPath, "");

    await expect(
      classifySolverFailure({
        agent: "codex",
        requestedModel: "gpt-5.5",
        timedOut: true,
        solverExitCode: undefined,
        tracePath,
        solverStdoutPath,
        solverStderrPath,
      }),
    ).resolves.toBe("timeout");
    await expect(
      classifySolverFailure({
        agent: "codex",
        requestedModel: "gpt-5.5",
        timedOut: false,
        solverExitCode: 0,
        tracePath,
        solverStdoutPath,
        solverStderrPath,
      }),
    ).resolves.toBe("none");

    await fs.writeFile(solverStderrPath, "Usage limit reached. Try again at 10:00.\n");
    await expect(
      classifySolverFailure({
        agent: "codex",
        requestedModel: "gpt-5.5",
        timedOut: false,
        solverExitCode: 1,
        tracePath,
        solverStdoutPath,
        solverStderrPath,
      }),
    ).resolves.toBe("usage-limit");

    await fs.writeFile(
      solverStderrPath,
      "warning: processed 401 files\nerror: unauthorized edit\n",
    );
    await expect(
      classifySolverFailure({
        agent: "codex",
        requestedModel: "gpt-5.5",
        timedOut: false,
        solverExitCode: 1,
        tracePath,
        solverStdoutPath,
        solverStderrPath,
      }),
    ).resolves.toBe("solver-nonzero");

    await fs.writeFile(solverStderrPath, "Error: unexpected status 401 Unauthorized\n");
    await expect(
      classifySolverFailure({
        agent: "codex",
        requestedModel: "gpt-5.5",
        timedOut: false,
        solverExitCode: 1,
        tracePath,
        solverStdoutPath,
        solverStderrPath,
      }),
    ).resolves.toBe("auth");

    await fs.writeFile(solverStderrPath, "codex CLI is not installed\n");
    await expect(
      classifySolverFailure({
        agent: "codex",
        requestedModel: "gpt-5.5",
        timedOut: false,
        solverExitCode: 127,
        tracePath,
        solverStdoutPath,
        solverStderrPath,
      }),
    ).resolves.toBe("runner-startup");
  });
});

describe("claude artifact summary", () => {
  test("summarizes Claude commands, tool calls, and the result event", async () => {
    const dir = await makeTempDir();
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(worktreePath, { recursive: true });
    const tracePath = path.join(dir, "trace.jsonl");
    const artifactSummaryPath = path.join(dir, "artifact-summary.json");
    await fs.copyFile(path.join(fixturesDir, "claude-stream-failing-command.jsonl"), tracePath);
    await fs.writeFile(path.join(dir, "solver.stdout.log"), "");
    await fs.writeFile(path.join(dir, "solver.stderr.log"), "");

    const summary = await writeArtifactSummary({
      problem: makeProblem(),
      runIndex: 0,
      worktreePath,
      tracePath,
      solverStdoutPath: path.join(dir, "solver.stdout.log"),
      solverStderrPath: path.join(dir, "solver.stderr.log"),
      artifactSummaryPath,
      agent: "claude",
      solverExitCode: 0,
      timedOut: false,
      failureKind: "none",
    });

    expect(summary.commands).toEqual([
      { command: 'sh -c "echo out; echo err >&2; exit 3"', exitCode: 3, status: "failed" },
      { command: "echo fine", exitCode: 0, status: "completed" },
    ]);
    expect(summary.failedCommands).toEqual([
      {
        command: 'sh -c "echo out; echo err >&2; exit 3"',
        exitCode: 3,
        status: "failed",
        outputTail: "Exit code 3\nout\nerr",
      },
    ]);
    expect(summary.agentResult).toMatchObject({
      toolCalls: 2,
      servedModels: ["claude-haiku-4-5-20251001"],
      numTurns: 3,
      isError: false,
    });
    expect(JSON.parse(await fs.readFile(artifactSummaryPath, "utf8"))).toEqual(summary);
  });

  test("classifies Claude runs from structured trace fields", async () => {
    const dir = await makeTempDir();
    const tracePath = path.join(dir, "trace.jsonl");
    const solverStdoutPath = path.join(dir, "solver.stdout.log");
    const solverStderrPath = path.join(dir, "solver.stderr.log");
    await fs.writeFile(solverStdoutPath, "");
    await fs.writeFile(solverStderrPath, "");
    const classify = (
      trace: unknown[],
      solverExitCode: number | undefined,
      requestedModel = "claude-haiku-4-5",
    ) =>
      fs.writeFile(tracePath, trace.map((event) => JSON.stringify(event)).join("\n")).then(() =>
        classifySolverFailure({
          agent: "claude",
          requestedModel,
          timedOut: false,
          solverExitCode,
          tracePath,
          solverStdoutPath,
          solverStderrPath,
        }),
      );
    const fixture = (
      await fs.readFile(path.join(fixturesDir, "claude-stream-failing-command.jsonl"), "utf8")
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);

    await expect(classify(fixture, 0)).resolves.toBe("none");
    await expect(classify(fixture, 0, "claude-opus-5-5")).resolves.toBe("model-mismatch");
    await expect(
      classify(
        [
          { type: "rate_limit_event", rate_limit_info: { status: "rejected" } },
          { type: "result", subtype: "success", is_error: true, api_error_status: 429 },
        ],
        1,
      ),
    ).resolves.toBe("usage-limit");
    await expect(
      classify(
        [
          {
            type: "assistant",
            parent_tool_use_id: null,
            message: { model: "<synthetic>", content: [{ type: "text", text: "API Error" }] },
          },
          { type: "result", subtype: "success", is_error: true, api_error_status: 429 },
        ],
        1,
      ),
    ).resolves.toBe("usage-limit");
    await expect(
      classify([{ type: "result", subtype: "success", is_error: true, api_error_status: 401 }], 1),
    ).resolves.toBe("auth");
    await expect(
      classify([{ type: "result", subtype: "success", is_error: true, api_error_status: 529 }], 1),
    ).resolves.toBe("api-error");
    await expect(classify([], 1)).resolves.toBe("runner-startup");
    await expect(classify([], 0)).resolves.toBe("unknown");
    await expect(classify(fixture.slice(0, 3), 0)).resolves.toBe("unknown");
    await expect(
      classify(
        [
          {
            type: "result",
            subtype: "error_max_budget_usd",
            is_error: true,
            api_error_status: null,
          },
        ],
        1,
      ),
    ).resolves.toBe("solver-nonzero");
  });
});

describe("verification summary", () => {
  test("loads every problem verification spec without definition errors", async () => {
    const dir = await makeTempDir();
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.writeFile(path.join(worktreePath, "package.json"), "{}\n");
    const problems = await discoverProblems(packageRoot);

    for (const problem of problems) {
      const summary = await writeVerificationSummary({
        problem,
        runIndex: 0,
        worktreePath,
        verificationSummaryPath: path.join(dir, `${problem.group}-${problem.id}.json`),
        verificationStdoutPath: path.join(dir, `${problem.group}-${problem.id}.stdout.log`),
        verificationStderrPath: path.join(dir, `${problem.group}-${problem.id}.stderr.log`),
      });

      expect(summary.checks.filter((check) => check.outcome === "error")).toEqual([]);
    }
  });

  test.each([
    { name: "malformed JSON", contents: "{" },
    { name: "a null root", contents: JSON.stringify(null) },
    { name: "an array root", contents: JSON.stringify([]) },
    { name: "an empty object", contents: JSON.stringify({}) },
    {
      name: "missing schemaVersion",
      contents: JSON.stringify({ checks: [] }),
    },
    {
      name: "missing checks",
      contents: JSON.stringify({ schemaVersion: 1 }),
    },
    {
      name: "non-array checks",
      contents: JSON.stringify({ schemaVersion: 1, checks: {} }),
    },
    {
      name: "an unsupported schema version",
      contents: JSON.stringify({ schemaVersion: 2, checks: [] }),
    },
    {
      name: "an unknown root field",
      contents: JSON.stringify({ schemaVersion: 1, checks: [], extra: true }),
    },
    {
      name: "a non-object check",
      contents: JSON.stringify({ schemaVersion: 1, checks: [null] }),
    },
    {
      name: "an empty check id",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: " ", kind: "file-exists", path: "package.json" }],
      }),
    },
    {
      name: "duplicate check ids",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [
          { id: "duplicate", kind: "file-exists", path: "package.json" },
          { id: "duplicate", kind: "file-exists", path: "missing.json" },
        ],
      }),
    },
    {
      name: "a reserved common check id",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "workspace-package-json", kind: "file-exists", path: "package.json" }],
      }),
    },
    {
      name: "an unknown check kind",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "unknown", kind: "unknown" }],
      }),
    },
    {
      name: "a non-string description",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "description", kind: "file-exists", path: "package.json", description: 1 }],
      }),
    },
    {
      name: "an unknown check field",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "typo", kind: "file-glob", glob: "*.ts", minCount: 1, minMatches: 1 }],
      }),
    },
    {
      name: "a missing file path",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "file", kind: "file-exists" }],
      }),
    },
    {
      name: "an empty file glob",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "glob", kind: "file-glob", glob: "" }],
      }),
    },
    {
      name: "a non-positive minCount",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "files", kind: "file-glob", glob: "*.ts", minCount: 0 }],
      }),
    },
    {
      name: "a non-integer minCount",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "files", kind: "file-glob", glob: "*.ts", minCount: 1.5 }],
      }),
    },
    {
      name: "a missing content pattern",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "content", kind: "content-match", glob: "*.ts" }],
      }),
    },
    {
      name: "a non-positive minMatches",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [
          {
            id: "content",
            kind: "content-match",
            glob: "*.ts",
            pattern: "example",
            minMatches: -1,
          },
        ],
      }),
    },
    {
      name: "a non-integer minMatches",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [
          {
            id: "content",
            kind: "content-match",
            glob: "*.ts",
            pattern: "example",
            minMatches: "1",
          },
        ],
      }),
    },
    {
      name: "non-string regular expression flags",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "content", kind: "content-absent", glob: "*.ts", pattern: "x", flags: 1 }],
      }),
    },
    {
      name: "an invalid regular expression",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "content", kind: "content-match", glob: "*.ts", pattern: "[", flags: "" }],
      }),
    },
    {
      name: "an out-of-workspace path",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "outside", kind: "file-exists", path: "../outside.txt" }],
      }),
    },
    {
      name: "an excluded workspace path",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "internal", kind: "file-exists", path: ".challenge/sdk.tgz" }],
      }),
    },
    {
      name: "an excluded workspace glob",
      contents: JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "dependencies", kind: "file-glob", glob: "node_modules/**/*.ts" }],
      }),
    },
  ])("reports one definition error for $name", async ({ contents }) => {
    const { summary, verificationSummaryPath } = await writeTestVerificationSummary(contents);

    expect(summary.checks.filter((check) => check.scope === "problem")).toEqual([
      expect.objectContaining({
        id: "problem-verify-spec",
        outcome: "error",
        error: expect.stringMatching(/^verify\.json/u),
      }),
    ]);
    await expect(fs.readFile(verificationSummaryPath, "utf8")).resolves.toBe(
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  });

  test("allows an empty problem check list", async () => {
    const { summary } = await writeTestVerificationSummary(
      JSON.stringify({ schemaVersion: 1, checks: [] }),
    );

    expect(summary.checks.filter((check) => check.scope === "problem")).toEqual([]);
  });

  test("records common and problem-level minimum correctness checks", async () => {
    const dir = await makeTempDir();
    const problemRoot = path.join(dir, "problem");
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(path.join(problemRoot, "scaffold"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, "src"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, "docs"), { recursive: true });
    await fs.writeFile(path.join(worktreePath, "package.json"), "{}\n");
    await fs.writeFile(path.join(worktreePath, "src/note.txt"), "customer directory\n");
    await fs.writeFile(path.join(worktreePath, "docs/readme.md"), "notes\n");
    const verifyPath = path.join(problemRoot, "verify.json");
    await fs.writeFile(
      verifyPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          checks: [
            { id: "note-file", kind: "file-exists", path: "src/note.txt" },
            { id: "docs-file", kind: "file-glob", glob: "docs/*.md", minCount: 1 },
            {
              id: "customer-text",
              kind: "content-match",
              glob: "src/*.txt",
              pattern: "customer",
              flags: "",
              minMatches: 1,
            },
            {
              id: "secret-text-absent",
              kind: "content-absent",
              glob: "src/*.txt",
              pattern: "secret",
            },
            {
              id: "customer-text-absent",
              kind: "content-absent",
              glob: "src/*.txt",
              pattern: "customer",
            },
            { id: "missing-file", kind: "file-exists", path: "missing.txt" },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const summary = await writeVerificationSummary({
      problem: makeProblem({
        group: "cli",
        scaffoldPath: path.join(problemRoot, "scaffold"),
        verifyPath,
      }),
      runIndex: 0,
      worktreePath,
      verificationSummaryPath: path.join(dir, "verification-summary.json"),
      verificationStdoutPath: path.join(dir, "verification.stdout.log"),
      verificationStderrPath: path.join(dir, "verification.stderr.log"),
    });

    expect(summary.checks.find((check) => check.id === "workspace-package-json")).toMatchObject({
      outcome: "satisfied",
    });
    expect(summary.checks.find((check) => check.id === "typescript-no-emit")).toMatchObject({
      outcome: "skipped",
    });
    expect(summary.checks.find((check) => check.id === "note-file")).toMatchObject({
      scope: "problem",
      outcome: "satisfied",
    });
    expect(summary.checks.find((check) => check.id === "docs-file")).toMatchObject({
      outcome: "satisfied",
    });
    expect(summary.checks.find((check) => check.id === "customer-text")).toMatchObject({
      outcome: "satisfied",
    });
    expect(summary.checks.find((check) => check.id === "secret-text-absent")).toMatchObject({
      outcome: "satisfied",
    });
    expect(summary.checks.find((check) => check.id === "customer-text-absent")).toMatchObject({
      outcome: "unsatisfied",
    });
    expect(summary.checks.find((check) => check.id === "missing-file")).toMatchObject({
      outcome: "unsatisfied",
    });
    await expect(
      fs.readFile(path.join(dir, "verification-summary.json"), "utf8"),
    ).resolves.toContain('"problemId": "example"');
  });

  test("isolates TypeScript verification from the workspace compiler", async () => {
    const dir = await makeTempDir();
    const worktreePath = path.join(dir, "work");
    const fakeBinPath = path.join(dir, "bin");
    const podmanArgsPath = path.join(dir, "podman-args.json");
    const payloadPath = path.join(dir, "host-payload");
    await fs.mkdir(path.join(worktreePath, "src"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, "node_modules/typescript/bin"), { recursive: true });
    await fs.mkdir(fakeBinPath, { recursive: true });
    await fs.writeFile(path.join(worktreePath, "package.json"), "{}\n");
    await fs.writeFile(path.join(worktreePath, "src/app.ts"), "export {};\n");
    await fs.writeFile(
      path.join(worktreePath, "node_modules/typescript/bin/tsc"),
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(payloadPath)}, "executed");\n`,
    );
    const fakePodmanPath = path.join(fakeBinPath, "podman");
    await fs.writeFile(
      fakePodmanPath,
      `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(podmanArgsPath)}, JSON.stringify(process.argv.slice(2)));\n`,
    );
    await fs.chmod(fakePodmanPath, 0o755);

    vi.stubEnv("PATH", `${fakeBinPath}${path.delimiter}${process.env.PATH ?? ""}`);

    const summary = await writeVerificationSummary({
      problem: makeProblem({ group: "cli" }),
      runIndex: 0,
      worktreePath,
      verifierImage: "example.invalid/codex-verifier:test",
      verificationSummaryPath: path.join(dir, "verification-summary.json"),
      verificationStdoutPath: path.join(dir, "verification.stdout.log"),
      verificationStderrPath: path.join(dir, "verification.stderr.log"),
    });

    expect(summary.checks.find((check) => check.id === "typescript-no-emit")).toMatchObject({
      outcome: "satisfied",
    });

    await expect(fs.stat(payloadPath)).rejects.toMatchObject({ code: "ENOENT" });
    const podmanArgs = JSON.parse(await fs.readFile(podmanArgsPath, "utf8")) as string[];
    expect(podmanArgs).toContain("--network=none");
    expect(podmanArgs).toContain("--cap-drop=all");
    expect(podmanArgs).toContain(`${worktreePath}:/workspace:ro,Z`);
    expect(podmanArgs).toContain("example.invalid/codex-verifier:test");
    expect(podmanArgs.at(-1)).toContain(
      "--incremental true --tsBuildInfoFile /tmp/verification.tsbuildinfo",
    );
    expect(podmanArgs.some((argument) => argument.includes("/verifier/typescript/bin/tsc"))).toBe(
      true,
    );
  });

  test("records verifier infrastructure failures as errors instead of unsatisfied checks", async () => {
    const dir = await makeTempDir();
    const worktreePath = path.join(dir, "work");
    const fakeBinPath = path.join(dir, "bin");
    await fs.mkdir(path.join(worktreePath, "src"), { recursive: true });
    await fs.mkdir(fakeBinPath, { recursive: true });
    await fs.writeFile(path.join(worktreePath, "package.json"), "{}\n");
    await fs.writeFile(path.join(worktreePath, "src/app.ts"), "export {};\n");
    const verify = () =>
      writeVerificationSummary({
        problem: makeProblem({ group: "cli" }),
        runIndex: 0,
        worktreePath,
        verificationSummaryPath: path.join(dir, "verification-summary.json"),
        verificationStdoutPath: path.join(dir, "verification.stdout.log"),
        verificationStderrPath: path.join(dir, "verification.stderr.log"),
      }).then((summary) => summary.checks.find((check) => check.id === "typescript-no-emit"));

    vi.stubEnv("PATH", fakeBinPath);
    await expect(verify()).resolves.toMatchObject({ outcome: "error" });

    const fakePodmanPath = path.join(fakeBinPath, "podman");
    await fs.writeFile(fakePodmanPath, "#!/bin/sh\necho 'Error: image not known' >&2\nexit 125\n");
    await fs.chmod(fakePodmanPath, 0o755);
    vi.stubEnv("PATH", `${fakeBinPath}${path.delimiter}${process.env.PATH ?? ""}`);
    await expect(verify()).resolves.toMatchObject({ outcome: "error", exitCode: 125 });

    await fs.writeFile(
      fakePodmanPath,
      "#!/bin/sh\necho 'src/app.ts(1,1): error TS1005' \nexit 2\n",
    );
    await expect(verify()).resolves.toMatchObject({ outcome: "unsatisfied", exitCode: 2 });
  });

  test("rejects oversized content evidence without reading it in full", async () => {
    const dir = await makeTempDir();
    const problemRoot = path.join(dir, "problem");
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(path.join(problemRoot, "scaffold"), { recursive: true });
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.writeFile(path.join(worktreePath, "package.json"), "{}\n");
    await fs.writeFile(path.join(worktreePath, "large.txt"), Buffer.alloc(2 * 1024 * 1024, "a"));
    const verifyPath = path.join(problemRoot, "verify.json");
    await fs.writeFile(
      verifyPath,
      `${JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "large", kind: "content-match", glob: "*.txt", pattern: "a" }],
      })}\n`,
    );

    const summary = await writeVerificationSummary({
      problem: makeProblem({ group: "cli", verifyPath }),
      runIndex: 0,
      worktreePath,
      verificationSummaryPath: path.join(dir, "verification-summary.json"),
      verificationStdoutPath: path.join(dir, "verification.stdout.log"),
      verificationStderrPath: path.join(dir, "verification.stderr.log"),
    });

    expect(summary.checks.find((check) => check.id === "large")).toMatchObject({
      outcome: "error",
      error: expect.stringContaining("content evidence limit exceeded for large.txt"),
    });
  });

  test("rejects content checks with too many candidate files", async () => {
    const dir = await makeTempDir();
    const problemRoot = path.join(dir, "problem");
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(path.join(problemRoot, "scaffold"), { recursive: true });
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.writeFile(path.join(worktreePath, "package.json"), "{}\n");
    await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        fs.writeFile(path.join(worktreePath, `candidate-${index}.txt`), "safe\n"),
      ),
    );
    const verifyPath = path.join(problemRoot, "verify.json");
    await fs.writeFile(
      verifyPath,
      `${JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "many", kind: "content-absent", glob: "*.txt", pattern: "secret" }],
      })}\n`,
    );

    const summary = await writeVerificationSummary({
      problem: makeProblem({ group: "cli", verifyPath }),
      runIndex: 0,
      worktreePath,
      verificationSummaryPath: path.join(dir, "verification-summary.json"),
      verificationStdoutPath: path.join(dir, "verification.stdout.log"),
      verificationStderrPath: path.join(dir, "verification.stderr.log"),
    });

    expect(summary.checks.find((check) => check.id === "many")).toMatchObject({
      outcome: "error",
      error: expect.stringContaining("101 files exceeds 100"),
    });
  });

  test("rejects content checks whose aggregate input is oversized", async () => {
    const dir = await makeTempDir();
    const problemRoot = path.join(dir, "problem");
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(path.join(problemRoot, "scaffold"), { recursive: true });
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.writeFile(path.join(worktreePath, "package.json"), "{}\n");
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        fs.writeFile(path.join(worktreePath, `aggregate-${index}.txt`), Buffer.alloc(900_000, "a")),
      ),
    );
    const verifyPath = path.join(problemRoot, "verify.json");
    await fs.writeFile(
      verifyPath,
      `${JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "aggregate", kind: "content-match", glob: "*.txt", pattern: "a" }],
      })}\n`,
    );

    const summary = await writeVerificationSummary({
      problem: makeProblem({ group: "cli", verifyPath }),
      runIndex: 0,
      worktreePath,
      verificationSummaryPath: path.join(dir, "verification-summary.json"),
      verificationStdoutPath: path.join(dir, "verification.stdout.log"),
      verificationStderrPath: path.join(dir, "verification.stderr.log"),
    });

    expect(summary.checks.find((check) => check.id === "aggregate")).toMatchObject({
      outcome: "error",
      error: expect.stringContaining("total bytes exceed"),
    });
  });

  test("bounds pathological content regular expressions", async () => {
    const dir = await makeTempDir();
    const problemRoot = path.join(dir, "problem");
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(path.join(problemRoot, "scaffold"), { recursive: true });
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.writeFile(path.join(worktreePath, "package.json"), "{}\n");
    await fs.writeFile(path.join(worktreePath, "adversarial.txt"), `${"a".repeat(50_000)}!`);
    const verifyPath = path.join(problemRoot, "verify.json");
    await fs.writeFile(
      verifyPath,
      `${JSON.stringify({
        schemaVersion: 1,
        checks: [
          {
            id: "pathological",
            kind: "content-match",
            glob: "*.txt",
            pattern: "^(a+)+$",
          },
        ],
      })}\n`,
    );

    const startedAt = Date.now();
    const summary = await writeVerificationSummary({
      problem: makeProblem({ group: "cli", verifyPath }),
      runIndex: 0,
      worktreePath,
      verificationSummaryPath: path.join(dir, "verification-summary.json"),
      verificationStdoutPath: path.join(dir, "verification.stdout.log"),
      verificationStderrPath: path.join(dir, "verification.stderr.log"),
    });

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(summary.checks.find((check) => check.id === "pathological")).toMatchObject({
      outcome: "error",
      error: expect.stringContaining("timed out"),
    });
  });

  test("excludes SDK cache files from problem verification evidence", async () => {
    const dir = await makeTempDir();
    const problemRoot = path.join(dir, "problem");
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(path.join(problemRoot, "scaffold"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, ".tailor/cache"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, "src"), { recursive: true });
    await fs.writeFile(path.join(worktreePath, "package.json"), "{}\n");
    await fs.writeFile(path.join(worktreePath, ".tailor/cache/generated.ts"), "cacheOnly\n");
    await fs.symlink(
      path.join(worktreePath, ".tailor/cache/generated.ts"),
      path.join(worktreePath, "src/cache-alias.ts"),
    );
    const verifyPath = path.join(problemRoot, "verify.json");
    await fs.writeFile(
      verifyPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          checks: [
            {
              id: "cache-only-text",
              kind: "content-match",
              glob: "**/*.ts",
              pattern: "cacheOnly",
            },
            {
              id: "cache-alias-glob",
              kind: "file-glob",
              glob: "src/*.ts",
              minCount: 1,
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const summary = await writeVerificationSummary({
      problem: makeProblem({
        group: "cli",
        scaffoldPath: path.join(problemRoot, "scaffold"),
        verifyPath,
      }),
      runIndex: 0,
      worktreePath,
      verificationSummaryPath: path.join(dir, "verification-summary.json"),
      verificationStdoutPath: path.join(dir, "verification.stdout.log"),
      verificationStderrPath: path.join(dir, "verification.stderr.log"),
    });

    expect(summary.checks.find((check) => check.id === "cache-only-text")).toMatchObject({
      outcome: "unsatisfied",
    });
    expect(summary.checks.find((check) => check.id === "cache-alias-glob")).toMatchObject({
      outcome: "unsatisfied",
    });
    expect(summary.checks.find((check) => check.id === "typescript-no-emit")).toMatchObject({
      outcome: "skipped",
    });
  });

  test("excludes files reached through out-of-workspace symlinks from verification evidence", async () => {
    const dir = await makeTempDir();
    const problemRoot = path.join(dir, "problem");
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(path.join(problemRoot, "scaffold"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, "src"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, "src/directory.txt"));
    await fs.writeFile(path.join(worktreePath, "package.json"), "{}\n");
    const outsidePath = path.join(dir, "outside.txt");
    await fs.writeFile(outsidePath, "outside evidence\n");
    await fs.symlink(outsidePath, path.join(worktreePath, "src/outside.txt"));
    const verifyPath = path.join(problemRoot, "verify.json");
    await fs.writeFile(
      verifyPath,
      `${JSON.stringify({
        schemaVersion: 1,
        checks: [
          { id: "outside-file", kind: "file-exists", path: "src/outside.txt" },
          { id: "directory-file", kind: "file-exists", path: "src/directory.txt" },
          { id: "outside-glob", kind: "file-glob", glob: "src/*.txt", minCount: 1 },
          {
            id: "outside-content",
            kind: "content-match",
            glob: "src/*.txt",
            pattern: "outside evidence",
          },
        ],
      })}\n`,
    );

    const summary = await writeVerificationSummary({
      problem: makeProblem({
        group: "cli",
        scaffoldPath: path.join(problemRoot, "scaffold"),
        verifyPath,
      }),
      runIndex: 0,
      worktreePath,
      verificationSummaryPath: path.join(dir, "verification-summary.json"),
      verificationStdoutPath: path.join(dir, "verification.stdout.log"),
      verificationStderrPath: path.join(dir, "verification.stderr.log"),
    });

    expect(summary.checks.find((check) => check.id === "outside-file")).toMatchObject({
      outcome: "unsatisfied",
    });
    expect(summary.checks.find((check) => check.id === "directory-file")).toMatchObject({
      outcome: "unsatisfied",
    });
    expect(summary.checks.find((check) => check.id === "outside-glob")).toMatchObject({
      outcome: "unsatisfied",
    });
    expect(summary.checks.find((check) => check.id === "outside-content")).toMatchObject({
      outcome: "unsatisfied",
    });
  });
});

describe("workspace preparation", () => {
  test("copies scaffold, prompt, and the selected SDK tarball", async () => {
    const dir = await makeTempDir();
    const problemRoot = path.join(dir, "problem");
    const scaffoldPath = path.join(problemRoot, "scaffold");
    const sdkTarballPath = path.join(dir, "sdk.tgz");
    await fs.mkdir(scaffoldPath, { recursive: true });
    await fs.writeFile(path.join(problemRoot, "prompt.md"), "Do the task.\n");
    await fs.writeFile(path.join(scaffoldPath, "note.txt"), "scaffold\n");
    await fs.writeFile(sdkTarballPath, "tarball");
    const problem = makeProblem({
      promptPath: path.join(problemRoot, "prompt.md"),
      scaffoldPath,
    });

    const paths = await prepareWorkspace({
      outputDir: path.join(dir, "results/run"),
      problem,
      runIndex: 0,
      sdkTarballPath,
    });

    await expect(fs.readFile(paths.promptPath, "utf8")).resolves.toContain(
      "You are working in an isolated challenge workspace.",
    );
    await expect(fs.readFile(paths.promptPath, "utf8")).resolves.toContain(
      "Task:\n\nDo the task.\n",
    );
    await expect(fs.readFile(path.join(paths.worktreePath, "note.txt"), "utf8")).resolves.toBe(
      "scaffold\n",
    );
    await expect(
      fs.readFile(path.join(paths.worktreePath, ".challenge/tailor-platform-sdk.tgz"), "utf8"),
    ).resolves.toBe("tarball");
    await expect(
      fs.readFile(path.join(paths.worktreePath, "pnpm-workspace.yaml"), "utf8"),
    ).resolves.toContain('"@tailor-platform/sdk": true');
    await expect(fs.readFile(path.join(paths.worktreePath, ".npmrc"), "utf8")).resolves.toContain(
      "store-dir=.pnpm-store",
    );
    await expect(fs.readFile(path.join(paths.worktreePath, ".npmrc"), "utf8")).resolves.toContain(
      "reporter=append-only",
    );
    await expect(fs.access(path.join(paths.worktreePath, ".pnpm-store"))).resolves.toBeUndefined();
    await expect(fs.readFile(path.join(paths.worktreePath, ".gitignore"), "utf8")).resolves.toMatch(
      /node_modules\//,
    );
    await expect(fs.readFile(path.join(paths.worktreePath, ".gitignore"), "utf8")).resolves.toMatch(
      /\.pnpm-home\//,
    );
    await expect(fs.access(path.join(paths.worktreePath, ".git"))).resolves.toBeUndefined();
    await expect(
      fs.readFile(path.join(paths.worktreePath, ".git", "config"), "utf8"),
    ).resolves.toContain("llm-challenge@example.invalid");
    await expect(
      runCommand("git", ["config", "--get", "commit.gpgSign"], { cwd: paths.worktreePath }),
    ).resolves.toMatchObject({ stdout: "false\n" });
    const packageJson = JSON.parse(
      await fs.readFile(path.join(paths.worktreePath, "package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit");
    expect(packageJson.dependencies["@tailor-platform/sdk"]).toBe(
      "file:.challenge/tailor-platform-sdk.tgz",
    );
    expect(packageJson.devDependencies.tsx).toBe("4.21.1");
    expect(packageJson.devDependencies.typescript).toBe(
      (createRequire(import.meta.url)("typescript/package.json") as { version: string }).version,
    );
    const tsconfig = JSON.parse(
      await fs.readFile(path.join(paths.worktreePath, "tsconfig.json"), "utf8"),
    ) as {
      compilerOptions: Record<string, string>;
    };
    expect(tsconfig.compilerOptions).toMatchObject({
      module: "ESNext",
      moduleResolution: "bundler",
    });
  });

  test("uses null profile for cli problems", () => {
    expect(profileForProblem({ group: "cli" }, "full")).toBeNull();
    expect(profileForProblem({ group: "sdk-api" }, "full")).toBe("full");
  });

  test("prunes dependency and SDK cache directories", async () => {
    const dir = await makeTempDir();
    const worktreePath = path.join(dir, "work");
    await Promise.all(
      ["node_modules", ".pnpm-store", ".pnpm-home", ".cache", ".turbo", ".tailor/cache"].map(
        (name) => fs.mkdir(path.join(worktreePath, name), { recursive: true }),
      ),
    );

    await pruneWorkspaceDeps(worktreePath);

    for (const name of [
      "node_modules",
      ".pnpm-store",
      ".pnpm-home",
      ".cache",
      ".turbo",
      ".tailor/cache",
    ]) {
      await expect(fs.access(path.join(worktreePath, name))).rejects.toThrow("ENOENT");
    }
  });
});

describe("codex runner", () => {
  test("uses a digest-pinned default image", () => {
    expect(DEFAULT_CODEX_IMAGE).toMatch(/^ghcr\.io\/openai\/codex-universal@sha256:/);
  });

  test("keeps the shared pnpm store outside the solver workspace", () => {
    expect(CONTAINER_PNPM_STORE).not.toMatch(/^\/workspace(?:\/|$)/);
  });

  test("uses a pnpm 11-compatible store environment variable", async () => {
    const dir = await makeTempDir();
    const storePath = path.join(dir, "pnpm-store");
    const result = await runCommand("pnpm", ["store", "path"], {
      env: { [PNPM_STORE_ENV]: storePath },
    });

    expect(result.stdout.trim()).toBe(path.join(storePath, "v11"));
  });

  test("does not enable web search for challenge solves", () => {
    const args = buildCodexExecArgs({ model: "gpt-5.5", effort: "xhigh" });

    expect(args[0]).toBe("exec");
    expect(args).not.toContain("--search");
  });

  test("falls back to installing codex inside the container", () => {
    const script = buildCodexBootstrapScript(
      ["exec", "--model", "gpt-5.5", "-"],
      DEFAULT_CODEX_NPM_PACKAGE,
    );

    expect(script).toContain("if command -v codex >/dev/null 2>&1; then");
    expect(script).toContain("exec codex 'exec' '--model' 'gpt-5.5' '-'");
    expect(script).toContain(
      "exec npm exec --yes --no-update-notifier --loglevel error --package '@openai/codex@0.133.0' -- codex 'exec' '--model' 'gpt-5.5' '-'",
    );
  });

  test("builds a non-model preflight script", () => {
    const script = buildCodexPreflightScript(DEFAULT_CODEX_NPM_PACKAGE);

    expect(script).toContain("exec codex --version");
    expect(script).toContain(
      "exec npm exec --yes --no-update-notifier --loglevel error --package '@openai/codex@0.133.0' -- codex --version",
    );
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llm-challenge-test-"));
  tempDirs.push(dir);
  return dir;
}

async function writeTestVerificationSummary(contents: string): Promise<{
  summary: Awaited<ReturnType<typeof writeVerificationSummary>>;
  verificationSummaryPath: string;
}> {
  const dir = await makeTempDir();
  const problemRoot = path.join(dir, "problem");
  const worktreePath = path.join(dir, "work");
  await fs.mkdir(path.join(problemRoot, "scaffold"), { recursive: true });
  await fs.mkdir(worktreePath, { recursive: true });
  await fs.writeFile(path.join(worktreePath, "package.json"), "{}\n");
  await fs.writeFile(path.join(dir, "outside.txt"), "outside evidence\n");
  const verifyPath = path.join(problemRoot, "verify.json");
  const verificationSummaryPath = path.join(dir, "verification-summary.json");
  await fs.writeFile(verifyPath, contents);
  await fs.writeFile(verificationSummaryPath, '{"stale":true}\n');

  const summary = await writeVerificationSummary({
    problem: makeProblem({
      group: "cli",
      scaffoldPath: path.join(problemRoot, "scaffold"),
      verifyPath,
    }),
    runIndex: 0,
    worktreePath,
    verificationSummaryPath,
    verificationStdoutPath: path.join(dir, "verification.stdout.log"),
    verificationStderrPath: path.join(dir, "verification.stderr.log"),
  });

  return { summary, verificationSummaryPath };
}

function makeProblem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: "example",
    title: "Example",
    group: "sdk-api",
    sourcePath: "problems/sdk-api/example",
    promptPath: "/problem/prompt.md",
    scaffoldPath: "/problem/scaffold",
    ...overrides,
  };
}
