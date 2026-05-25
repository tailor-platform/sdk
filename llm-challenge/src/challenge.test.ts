import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseRunArgs, parseRunCommand } from "./args";
import { classifySolverFailure, writeArtifactSummary } from "./artifact-summary";
import { discoverProblems, selectProblems } from "./problems";
import { runCommand } from "./process";
import { applyNoDocsProfile, stripDeclarationJsDoc } from "./profile";
import { buildRunArtifactPaths, createRunReport, reportPath, writeReport } from "./report";
import {
  DEFAULT_CODEX_IMAGE,
  DEFAULT_CODEX_NPM_PACKAGE,
  buildCodexBootstrapScript,
  buildCodexPreflightScript,
} from "./runner";
import { prepareWorkspace, profileForProblem } from "./workspace";
import type { Problem } from "./types";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("argument parsing", () => {
  it("parses run defaults", () => {
    expect(parseRunCommand(["run"])).toMatchObject({
      sdkRef: "HEAD",
      profile: "no-docs",
      profileExplicit: false,
      group: "all",
      model: "gpt-5.5",
      effort: "xhigh",
      runs: 3,
      concurrency: 1,
      maxSeconds: 1800,
      preflight: true,
      pruneWorkspaceDeps: false,
      problemFilters: [],
    });
  });

  it("allows implicit profile with cli group", () => {
    expect(parseRunArgs(["--group", "cli"]).profileExplicit).toBe(false);
  });

  it("rejects explicit profile with cli group", () => {
    expect(() => parseRunArgs(["--group", "cli", "--profile", "full"])).toThrow(
      "--profile cannot be used with --group cli",
    );
  });

  it("parses repeated and comma-separated problem filters", () => {
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

  it("parses runner workflow options", () => {
    expect(
      parseRunArgs([
        "--no-preflight",
        "--prune-workspace-deps",
        "--rerun-nonzero-from",
        "results/run/report.json",
      ]),
    ).toMatchObject({
      preflight: false,
      pruneWorkspaceDeps: true,
      rerunNonzeroFrom: "results/run/report.json",
    });
    expect(() => parseRunArgs(["--no-preflight=true"])).toThrow(
      "--no-preflight does not accept a value",
    );
  });

  it("rejects an empty comma-separated problem filter", () => {
    expect(() => parseRunArgs(["--problems", ""])).toThrow(
      "--problems must contain at least one problem",
    );
    expect(() => parseRunArgs(["--problems=, ,"])).toThrow(
      "--problems must contain at least one problem",
    );
  });
});

describe("problem discovery", () => {
  it("discovers the initial problem set from group directories", async () => {
    const problems = await discoverProblems(packageRoot);

    expect(problems).toHaveLength(19);
    expect(problems.filter((problem) => problem.group === "sdk-api")).toHaveLength(15);
    expect(problems.filter((problem) => problem.group === "cli")).toHaveLength(4);
    expect(problems.map((problem) => problem.id)).toContain("plugin-registration");
    expect(
      problems.every((problem) => problem.sourcePath === `problems/${problem.group}/${problem.id}`),
    ).toBe(true);
  });

  it("selects problems by bare id and group-qualified id", async () => {
    const problems = await discoverProblems(packageRoot);

    expect(
      selectProblems(problems, "all", ["plugin-registration", "cli/generate"]).map(
        (problem) => problem.id,
      ),
    ).toEqual(["plugin-registration", "generate"]);
  });
});

describe("profile filtering", () => {
  it("removes docs entries and declaration JSDoc", async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, "docs"), { recursive: true });
    await fs.mkdir(path.join(dir, "dist"), { recursive: true });
    await fs.writeFile(path.join(dir, "README.md"), "docs");
    await fs.writeFile(path.join(dir, "CHANGELOG.md"), "changes");
    await fs.writeFile(path.join(dir, "docs/reference.md"), "reference");
    await fs.writeFile(path.join(dir, "dist/index.js"), "/** runtime comment */\nexport {};\n");
    await fs.writeFile(
      path.join(dir, "dist/index.mjs.map"),
      JSON.stringify({ sourcesContent: ["/** hidden docs */\nexport {};\n"] }),
    );
    await fs.writeFile(
      path.join(dir, "dist/index.d.ts"),
      "/** public docs */\nexport declare const value: string;\n/* keep */\nexport declare const other: string;\n",
    );

    await applyNoDocsProfile(dir);

    await expect(fs.access(path.join(dir, "README.md"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, "CHANGELOG.md"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, "docs"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, "dist/index.mjs.map"))).rejects.toThrow();
    await expect(fs.readFile(path.join(dir, "dist/index.js"), "utf8")).resolves.toContain(
      "/** runtime comment */",
    );
    await expect(fs.readFile(path.join(dir, "dist/index.d.ts"), "utf8")).resolves.toBe(
      "\nexport declare const value: string;\n/* keep */\nexport declare const other: string;\n",
    );
  });

  it("strips only JSDoc blocks from declaration text", () => {
    expect(stripDeclarationJsDoc("/** remove */\nexport type A = string;\n/* keep */\n")).toBe(
      "\nexport type A = string;\n/* keep */\n",
    );
  });
});

describe("report and artifact paths", () => {
  it("builds the required run artifact layout", () => {
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
    });
  });

  it("writes report paths relative to llm-challenge", async () => {
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
      schemaVersion: 1,
      runId: "run",
      timestamp: "2026-05-24T00:00:00.000Z",
      sdkRef: "abc123",
      requestedProfile: "no-docs",
      model: "gpt-5.5",
      effort: "xhigh",
      runsPerProblem: 1,
      problems: [],
      runs: [run],
    });

    const written = JSON.parse(await fs.readFile(reportFile, "utf8")) as {
      runs: Array<{ artifactDir: string; artifactSummaryPath: string }>;
    };
    expect(written.runs[0].artifactDir).toBe("results/run/sdk-api/example/run-0");
    expect(written.runs[0].artifactSummaryPath).toBe(
      "results/run/sdk-api/example/run-0/artifact-summary.json",
    );
    expect(reportPath(packageRoot, path.join(packageRoot, "results/run/report.json"))).toBe(
      "results/run/report.json",
    );
  });
});

describe("artifact summary", () => {
  it("indexes useful solver artifacts without cache-heavy directories", async () => {
    const dir = await makeTempDir();
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(path.join(worktreePath, "src"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, "node_modules/pkg"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, ".pnpm-home/store"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, ".tailor-sdk/cache"), { recursive: true });
    await fs.mkdir(path.join(worktreePath, ".turbo/cache"), { recursive: true });
    await fs.writeFile(path.join(worktreePath, "src/app.ts"), "export {};\n");
    await fs.writeFile(path.join(worktreePath, "node_modules/pkg/index.js"), "");
    await fs.writeFile(path.join(worktreePath, ".pnpm-home/store/index.db"), "");
    await fs.writeFile(path.join(worktreePath, ".tailor-sdk/cache/generated.json"), "{}");
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
    expect(summary.files).not.toContain(".tailor-sdk/cache/generated.json");
    expect(summary.files).not.toContain(".turbo/cache/state.json");
    expect(summary.gitStatus).toContain("?? src/app.ts");
    expect(summary.commands.map((command) => command.command)).toEqual(["pnpm test", "pnpm build"]);
    expect(summary.failedCommands).toHaveLength(1);
    expect(summary.failedCommands[0].command).toBe("pnpm build");
    expect(summary.failedCommands[0].outputTail).toHaveLength(1_000);
    expect(summary.errors).toEqual(["solver error"]);
  });

  it("classifies timeout, successful, usage-limit, and runner-startup failures", async () => {
    const dir = await makeTempDir();
    const tracePath = path.join(dir, "trace.jsonl");
    const solverStdoutPath = path.join(dir, "solver.stdout.log");
    const solverStderrPath = path.join(dir, "solver.stderr.log");
    await fs.writeFile(tracePath, "");
    await fs.writeFile(solverStdoutPath, "");
    await fs.writeFile(solverStderrPath, "");

    await expect(
      classifySolverFailure({
        timedOut: true,
        solverExitCode: undefined,
        tracePath,
        solverStdoutPath,
        solverStderrPath,
      }),
    ).resolves.toBe("timeout");
    await expect(
      classifySolverFailure({
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
        timedOut: false,
        solverExitCode: 1,
        tracePath,
        solverStdoutPath,
        solverStderrPath,
      }),
    ).resolves.toBe("usage-limit");

    await fs.writeFile(solverStderrPath, "codex CLI is not installed\n");
    await expect(
      classifySolverFailure({
        timedOut: false,
        solverExitCode: 127,
        tracePath,
        solverStdoutPath,
        solverStderrPath,
      }),
    ).resolves.toBe("runner-startup");
  });
});

describe("workspace preparation", () => {
  it("copies scaffold, prompt, and the selected SDK tarball", async () => {
    const dir = await makeTempDir();
    const problemRoot = path.join(dir, "problem");
    const scaffoldPath = path.join(problemRoot, "scaffold");
    const sdkTarballPath = path.join(dir, "sdk.tgz");
    await fs.mkdir(scaffoldPath, { recursive: true });
    await fs.writeFile(path.join(problemRoot, "prompt.md"), "Do the task.\n");
    await fs.writeFile(path.join(scaffoldPath, "note.txt"), "scaffold\n");
    await fs.writeFile(sdkTarballPath, "tarball");
    const problem = makeProblem({
      absolutePath: problemRoot,
      promptPath: path.join(problemRoot, "prompt.md"),
      scaffoldPath,
    });

    const paths = await prepareWorkspace({
      outputDir: path.join(dir, "results/run"),
      problem,
      runIndex: 0,
      sdkTarballPath,
    });

    await expect(fs.readFile(paths.promptPath, "utf8")).resolves.toBe("Do the task.\n");
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
    const packageJson = JSON.parse(
      await fs.readFile(path.join(paths.worktreePath, "package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies["@tailor-platform/sdk"]).toBe(
      "file:.challenge/tailor-platform-sdk.tgz",
    );
  });

  it("uses null profile for cli problems", () => {
    expect(profileForProblem({ group: "cli" }, "full")).toBeNull();
    expect(profileForProblem({ group: "sdk-api" }, "full")).toBe("full");
  });
});

describe("codex runner", () => {
  it("uses a digest-pinned default image", () => {
    expect(DEFAULT_CODEX_IMAGE).toMatch(/^ghcr\.io\/openai\/codex-universal@sha256:/);
  });

  it("falls back to installing codex inside the container", () => {
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

  it("builds a non-model preflight script", () => {
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

function makeProblem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: "example",
    title: "Example",
    group: "sdk-api",
    sourcePath: "problems/sdk-api/example",
    absolutePath: "/problem",
    promptPath: "/problem/prompt.md",
    scaffoldPath: "/problem/scaffold",
    ...overrides,
  };
}
