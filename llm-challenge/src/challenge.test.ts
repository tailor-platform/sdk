import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseRunArgs, parseRunCommand } from "./args";
import { discoverProblems, selectProblems } from "./problems";
import { applyNoDocsProfile, stripDeclarationJsDoc } from "./profile";
import { buildRunArtifactPaths, createRunReport, reportPath, writeReport } from "./report";
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
      path.join(dir, "dist/index.d.ts"),
      "/** public docs */\nexport declare const value: string;\n/* keep */\nexport declare const other: string;\n",
    );

    await applyNoDocsProfile(dir);

    await expect(fs.access(path.join(dir, "README.md"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, "CHANGELOG.md"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, "docs"))).rejects.toThrow();
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
      runs: Array<{ artifactDir: string }>;
    };
    expect(written.runs[0].artifactDir).toBe("results/run/sdk-api/example/run-0");
    expect(reportPath(packageRoot, path.join(packageRoot, "results/run/report.json"))).toBe(
      "results/run/report.json",
    );
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
