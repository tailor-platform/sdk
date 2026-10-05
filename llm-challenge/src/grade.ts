import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getClaudeRuntimeConfig,
  preflightClaudeRunner,
  resolveClaudeOAuthToken,
} from "./claude-runner";
import { summarizeClaudeTrace } from "./claude-trace";
import {
  JUDGE_PROMPT_VERSION,
  buildJudgeOutputSchema,
  buildJudgePrompt,
  evaluateJudgeOutput,
  prepareJudgeWorkspace,
  runJudgeInPodman,
  type ClaimGrade,
  type JudgeEvaluation,
} from "./judge";
import { discoverProblems } from "./problems";
import { reportPath, resolveExistingReportPath } from "./report";
import { loadRubric, type Rubric } from "./rubric";
import { createRunId, isObject, runWithConcurrency, tailText } from "./utils";
import type {
  ChallengeRunReport,
  Problem,
  ProblemGroup,
  SolverAgent,
  SolverFailureKind,
  StoredChallengeReport,
} from "./types";

export type GradeOptions = {
  reports: string[];
  judgeModel: string;
  judgeEffort: string;
  concurrency: number;
  maxSeconds: number;
  output?: string;
  preflight: boolean;
  allowSelfJudge: boolean;
};

export type RunGradeStatus = "ok" | "excluded" | "error";

export type RunGradeMetrics = {
  pass: 0 | 1;
  claimRate: number;
  commonChecks: 0 | 1;
};

export type RunGrade = {
  problemId: string;
  group: ProblemGroup;
  runIndex: number;
  artifactDir: string;
  status: RunGradeStatus;
  reason?: string;
  metrics?: RunGradeMetrics;
  failureKind?: SolverFailureKind;
  claims?: ClaimGrade[];
  judge?: { costUsd?: number; numTurns?: number; durationMs?: number; servedModels: string[] };
  solver?: { costUsd?: number; numTurns?: number; durationMs?: number; toolCalls?: number };
};

export type GradeSummary = {
  problems: Array<{
    problemId: string;
    group: ProblemGroup;
    scoredRuns: number;
    passes: number;
    passRate?: number;
    claimRate?: number;
  }>;
  overall: {
    problems: number;
    scoredRuns: number;
    excludedRuns: number;
    errorRuns: number;
    passRate: number;
    ci95: [number, number];
    claimRate: number;
  };
};

type VerificationCheck = { scope: "common" | "problem"; outcome: string };

type CommandEvidence = {
  command: string;
  exitCode?: number;
  status?: string;
  outputTail?: string;
};

const COMMAND_OUTPUT_TAIL = 2_000;

const DEFAULT_JUDGE_MODEL = "claude-opus-5-5";
const DEFAULT_JUDGE_EFFORT = "high";
const EXCLUDED_FAILURE_KINDS = new Set<SolverFailureKind>([
  "timeout",
  "usage-limit",
  "auth",
  "model-mismatch",
  "runner-startup",
  "unknown",
]);
const BOOTSTRAP_ITERATIONS = 5_000;
const BOOTSTRAP_SEED = 20_260_930;

export function parseGradeArgs(argv: string[]): GradeOptions {
  const options: GradeOptions = {
    reports: [],
    judgeModel: DEFAULT_JUDGE_MODEL,
    judgeEffort: DEFAULT_JUDGE_EFFORT,
    concurrency: 1,
    maxSeconds: 900,
    preflight: true,
    allowSelfJudge: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const equalsIndex = token.indexOf("=");
    const name = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1);
    if (name === "--no-preflight" || name === "--allow-self-judge") {
      if (inlineValue !== undefined) {
        throw new Error(`${name} does not accept a value`);
      }
      if (name === "--no-preflight") {
        options.preflight = false;
      } else {
        options.allowSelfJudge = true;
      }
      continue;
    }
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${name}`);
    }
    switch (name) {
      case "--report":
        options.reports.push(value);
        break;
      case "--judge-model":
        options.judgeModel = value;
        break;
      case "--judge-effort":
        options.judgeEffort = value;
        break;
      case "--concurrency":
        options.concurrency = parsePositiveInteger(name, value);
        break;
      case "--max-seconds":
        options.maxSeconds = parsePositiveInteger(name, value);
        break;
      case "--output":
        options.output = value;
        break;
      default:
        throw new Error(`Unknown option: ${name}`);
    }
  }
  if (options.reports.length === 0) {
    throw new Error("--report is required");
  }
  return options;
}

export function decideRunGrade(options: {
  failureKind?: SolverFailureKind;
  checks: VerificationCheck[];
  judge?:
    | Pick<Extract<JudgeEvaluation, { status: "ok" }>, "status" | "claims">
    | { status: "error"; error: string };
}): Pick<RunGrade, "status" | "reason" | "metrics"> {
  const failureKind = options.failureKind ?? "unknown";
  if (EXCLUDED_FAILURE_KINDS.has(failureKind)) {
    return { status: "excluded", reason: `solver ${failureKind}` };
  }
  if (options.checks.some((check) => check.outcome === "error")) {
    return { status: "error", reason: "verification error" };
  }
  if (options.judge === undefined) {
    return { status: "error", reason: "judge not run" };
  }
  if (options.judge.status === "error") {
    return { status: "error", reason: options.judge.error };
  }
  const commonChecks = options.checks
    .filter((check) => check.scope === "common")
    .every((check) => check.outcome !== "unsatisfied")
    ? 1
    : 0;
  const satisfied = options.judge.claims.filter((claim) => claim.counted === "satisfied").length;
  const claimRate = options.judge.claims.length === 0 ? 0 : satisfied / options.judge.claims.length;
  const pass = failureKind === "none" && commonChecks === 1 && claimRate === 1 ? 1 : 0;
  return { status: "ok", metrics: { pass, claimRate, commonChecks } };
}

export function summarizeGrades(
  grades: RunGrade[],
  bootstrap: { seed: number; iterations: number } = {
    seed: BOOTSTRAP_SEED,
    iterations: BOOTSTRAP_ITERATIONS,
  },
): GradeSummary {
  const byProblem = new Map<string, RunGrade[]>();
  for (const grade of grades) {
    const key = `${grade.group}/${grade.problemId}`;
    byProblem.set(key, [...(byProblem.get(key) ?? []), grade]);
  }
  const problems = [...byProblem.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, problemGrades]) => {
      const scored = problemGrades.flatMap((grade) =>
        grade.status === "ok" && grade.metrics !== undefined ? [grade.metrics] : [],
      );
      const passes = scored.filter((metrics) => metrics.pass === 1).length;
      return {
        problemId: problemGrades[0].problemId,
        group: problemGrades[0].group,
        scoredRuns: scored.length,
        passes,
        passRate: scored.length === 0 ? undefined : passes / scored.length,
        claimRate:
          scored.length === 0 ? undefined : mean(scored.map((metrics) => metrics.claimRate)),
        passValues: scored.map((metrics) => metrics.pass as number),
      };
    });
  const scoredProblems = problems.filter((problem) => problem.scoredRuns > 0);
  const passRate = mean(scoredProblems.map((problem) => problem.passRate ?? 0));
  return {
    problems: problems.map(({ passValues: _passValues, ...problem }) => problem),
    overall: {
      problems: scoredProblems.length,
      scoredRuns: scoredProblems.reduce((sum, problem) => sum + problem.scoredRuns, 0),
      excludedRuns: grades.filter((grade) => grade.status === "excluded").length,
      errorRuns: grades.filter((grade) => grade.status === "error").length,
      passRate,
      ci95: clusterBootstrapInterval(
        scoredProblems.map((problem) => problem.passValues),
        bootstrap.seed,
        bootstrap.iterations,
      ),
      claimRate: mean(scoredProblems.map((problem) => problem.claimRate ?? 0)),
    },
  };
}

export async function gradeCommand(argv: string[], packageRoot: string): Promise<void> {
  const options = parseGradeArgs(argv);
  const sources = await Promise.all(
    options.reports.map(async (reportFile) => {
      const resolved = await resolveExistingReportPath(packageRoot, reportFile);
      return {
        path: resolved,
        report: JSON.parse(await fs.readFile(resolved, "utf8")) as StoredChallengeReport,
      };
    }),
  );
  const selfJudged = sources.filter(
    (source) =>
      (source.report.agent ?? "codex") === "claude" && source.report.model === options.judgeModel,
  );
  if (selfJudged.length > 0 && !options.allowSelfJudge) {
    throw new Error(
      `${options.judgeModel} would grade its own runs (${selfJudged.map((source) => reportPath(packageRoot, source.path)).join(", ")}); pass another --judge-model for every report in the comparison, or --allow-self-judge`,
    );
  }

  const replaced = new Set(
    sources.flatMap((source) =>
      source.report.runs.flatMap((run) =>
        run.replaces?.artifactDir ? [run.replaces.artifactDir] : [],
      ),
    ),
  );
  const runs = sources.flatMap((source) =>
    source.report.runs
      .filter((run) => !replaced.has(run.artifactDir))
      .map((run) => ({ source, run })),
  );
  const problems = new Map(
    (await discoverProblems(packageRoot)).map((problem) => [
      `${problem.group}/${problem.id}`,
      problem,
    ]),
  );
  const rubrics = new Map<string, { rubric: Rubric; hash: string } | Error>();
  for (const { run } of runs) {
    const key = `${run.group}/${run.problemId}`;
    if (!rubrics.has(key)) {
      const problem = problems.get(key);
      rubrics.set(
        key,
        problem === undefined
          ? new Error(`unknown problem ${key}`)
          : await loadRubric(problem).catch((error: unknown) =>
              error instanceof Error ? error : new Error(String(error)),
            ),
      );
    }
  }

  const runtime = getClaudeRuntimeConfig(packageRoot);
  const token = await resolveClaudeOAuthToken({ env: process.env, tokenFile: runtime.tokenFile });
  let judgeVersion: string | undefined;
  if (options.preflight) {
    console.log(`Preflight judge ${options.judgeModel}`);
    const preflight = await preflightClaudeRunner({ runtime, token, model: options.judgeModel });
    if (preflight.exitCode !== 0) {
      throw new Error(`Judge preflight failed\n${preflight.stderr ?? ""}`.trim());
    }
    judgeVersion = preflight.claudeVersion;
  }

  const gradeId = createRunId();
  const outputDir = path.resolve(
    packageRoot,
    options.output ?? path.join(path.dirname(sources[0].path), "grades", gradeId),
  );
  await fs.mkdir(outputDir, { recursive: true });
  const gradesPath = path.join(outputDir, "grades.jsonl");
  await fs.writeFile(gradesPath, "");
  const grades: RunGrade[] = [];

  await runWithConcurrency(runs, options.concurrency, async ({ source, run }) => {
    const key = `${run.group}/${run.problemId}`;
    const grade = await gradeRun({
      agent: source.report.agent ?? "codex",
      packageRoot,
      gradeId,
      outputDir,
      run,
      problem: problems.get(key),
      rubric: rubrics.get(key),
      options,
      runtime,
      token,
    });
    grades.push(grade);
    await fs.appendFile(gradesPath, `${JSON.stringify(grade)}\n`);
    console.log(
      `${key.padEnd(44)} ${String(run.runIndex).padEnd(4)} ${grade.status.padEnd(9)} ${
        grade.metrics === undefined
          ? (grade.reason ?? "")
          : `pass=${grade.metrics.pass} claims=${grade.metrics.claimRate.toFixed(2)}`
      }`,
    );
  });

  const summary = summarizeGrades(grades);
  await fs.writeFile(
    path.join(outputDir, "summary.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        gradeId,
        createdAt: new Date().toISOString(),
        judge: {
          model: options.judgeModel,
          effort: options.judgeEffort,
          claudeCodePackage: runtime.claudePackage,
          claudeCodeVersion: judgeVersion,
          promptVersion: JUDGE_PROMPT_VERSION,
        },
        rubricHashes: Object.fromEntries(
          [...rubrics.entries()].flatMap(([key, value]) =>
            value instanceof Error ? [] : [[key, value.hash]],
          ),
        ),
        reports: sources.map((source) => ({
          path: reportPath(packageRoot, source.path),
          runId: source.report.runId,
          agent: source.report.agent ?? "codex",
          model: source.report.model,
          effort: source.report.effort,
          sdkRef: source.report.sdkRef,
          profile: source.report.requestedProfile,
        })),
        ...summary,
      },
      null,
      2,
    )}\n`,
  );
  const [low, high] = summary.overall.ci95;
  console.log(
    `Pass rate ${(summary.overall.passRate * 100).toFixed(1)}% (95% CI ${(low * 100).toFixed(1)}-${(high * 100).toFixed(1)}%) over ${summary.overall.problems} problems, ${summary.overall.scoredRuns} scored runs; excluded=${summary.overall.excludedRuns} error=${summary.overall.errorRuns}`,
  );
  console.log(`Grades ${reportPath(packageRoot, outputDir)}`);
}

async function gradeRun(options: {
  agent: SolverAgent;
  packageRoot: string;
  gradeId: string;
  outputDir: string;
  run: ChallengeRunReport;
  problem?: Problem;
  rubric?: { rubric: Rubric; hash: string } | Error;
  options: GradeOptions;
  runtime: ReturnType<typeof getClaudeRuntimeConfig>;
  token: string;
}): Promise<RunGrade> {
  const { run } = options;
  const base: RunGrade = {
    problemId: run.problemId,
    group: run.group,
    runIndex: run.runIndex,
    artifactDir: run.artifactDir,
    status: "error",
    failureKind: run.failureKind,
    solver: {
      costUsd: run.agentResult?.totalCostUsd,
      numTurns: run.agentResult?.numTurns,
      durationMs: run.agentResult?.durationMs ?? run.durationMs,
      toolCalls: run.agentResult?.toolCalls,
    },
  };
  const preliminary = decideRunGrade({
    failureKind: run.failureKind,
    checks: [],
    judge: undefined,
  });
  if (preliminary.status === "excluded") {
    return { ...base, ...preliminary };
  }
  if (options.rubric === undefined || options.rubric instanceof Error) {
    return { ...base, reason: options.rubric?.message ?? "rubric missing" };
  }
  const artifactDir = path.resolve(options.packageRoot, run.artifactDir);
  const checks = await readVerificationChecks(path.join(artifactDir, "verification-summary.json"));
  if (checks === undefined) {
    return { ...base, reason: "verification summary missing" };
  }

  const gradeDir = path.join(
    options.outputDir,
    "runs",
    run.group,
    run.problemId,
    `run-${run.runIndex}`,
  );
  const workspaceDir = path.join(gradeDir, "workspace");
  const evidenceDir = path.join(gradeDir, "evidence");
  await fs.mkdir(evidenceDir, { recursive: true });
  const workspace = await prepareJudgeWorkspace(path.join(artifactDir, "work"), workspaceDir);
  await fs.writeFile(
    path.join(evidenceDir, "commands.json"),
    `${JSON.stringify(
      await buildCommandEvidence({
        agent: options.agent,
        tracePath: path.join(artifactDir, "trace.jsonl"),
        artifactSummaryPath: path.join(artifactDir, "artifact-summary.json"),
      }),
      null,
      2,
    )}\n`,
  );
  const claims = options.rubric.rubric.claims;
  const prompt = buildJudgePrompt({
    taskPrompt: await fs.readFile(path.join(artifactDir, "prompt.md"), "utf8"),
    claims,
    workspace,
  });
  await fs.writeFile(path.join(gradeDir, "judge-prompt.md"), prompt);
  const tracePath = path.join(gradeDir, "judge.trace.jsonl");
  const result = await runJudgeInPodman({
    containerName:
      `llm-challenge-grade-${options.gradeId}-${run.group}-${run.problemId}-${run.runIndex}`
        .toLowerCase()
        .replaceAll(/[^a-z0-9_.-]+/g, "-"),
    workspaceDir,
    evidenceDir,
    prompt,
    model: options.options.judgeModel,
    effort: options.options.judgeEffort,
    schema: buildJudgeOutputSchema(claims.map((claim) => claim.id)),
    runtime: options.runtime,
    token: options.token,
    stdoutPath: path.join(gradeDir, "judge.stdout.log"),
    stderrPath: path.join(gradeDir, "judge.stderr.log"),
    tracePath,
    maxSeconds: options.options.maxSeconds,
  });
  const judge: JudgeEvaluation = result.timedOut
    ? { status: "error", error: "judge timed out" }
    : await evaluateJudgeOutput({
        events: await readJsonLines(tracePath),
        claims,
        judgeModel: options.options.judgeModel,
        workspaceDir,
        evidenceDir,
      });
  const decided = decideRunGrade({ failureKind: run.failureKind, checks, judge });
  const grade: RunGrade = {
    ...base,
    ...decided,
    claims: judge.status === "ok" ? judge.claims : undefined,
    judge:
      judge.status === "ok"
        ? {
            costUsd: judge.costUsd,
            numTurns: judge.numTurns,
            durationMs: judge.durationMs,
            servedModels: judge.servedModels,
          }
        : undefined,
  };
  await fs.writeFile(path.join(gradeDir, "grade.json"), `${JSON.stringify(grade, null, 2)}\n`);
  return grade;
}

async function readVerificationChecks(filePath: string): Promise<VerificationCheck[] | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    if (!isObject(parsed) || !Array.isArray(parsed.checks)) {
      return undefined;
    }
    return parsed.checks.flatMap((check) =>
      isObject(check) &&
      (check.scope === "common" || check.scope === "problem") &&
      typeof check.outcome === "string"
        ? [{ scope: check.scope, outcome: check.outcome }]
        : [],
    );
  } catch {
    return undefined;
  }
}

export async function buildCommandEvidence(options: {
  agent: SolverAgent;
  tracePath: string;
  artifactSummaryPath: string;
}): Promise<CommandEvidence[]> {
  if (options.agent === "claude") {
    return summarizeClaudeTrace(await readJsonLines(options.tracePath)).commands.map((command) => ({
      command: command.command,
      exitCode: command.exitCode,
      status: command.status,
      ...(command.output === undefined
        ? {}
        : { outputTail: tailText(command.output, COMMAND_OUTPUT_TAIL) }),
    }));
  }
  try {
    const parsed = JSON.parse(await fs.readFile(options.artifactSummaryPath, "utf8")) as unknown;
    if (!isObject(parsed) || !Array.isArray(parsed.commands)) {
      return [];
    }
    const failedOutput = new Map(
      (Array.isArray(parsed.failedCommands) ? parsed.failedCommands : [])
        .filter(isObject)
        .flatMap((command) =>
          typeof command.command === "string" && typeof command.outputTail === "string"
            ? [[command.command, command.outputTail] as const]
            : [],
        ),
    );
    return parsed.commands.filter(isObject).flatMap((command) =>
      typeof command.command === "string"
        ? [
            {
              command: command.command,
              exitCode: typeof command.exitCode === "number" ? command.exitCode : undefined,
              status: typeof command.status === "string" ? command.status : undefined,
              ...(failedOutput.has(command.command)
                ? { outputTail: failedOutput.get(command.command) }
                : {}),
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}

async function readJsonLines(filePath: string): Promise<unknown[]> {
  try {
    return (await fs.readFile(filePath, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function clusterBootstrapInterval(
  clusters: number[][],
  seed: number,
  iterations: number,
): [number, number] {
  if (clusters.length === 0) {
    return [0, 0];
  }
  const random = mulberry32(seed);
  const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)];
  const estimates: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = pick(clusters);
      let clusterTotal = 0;
      for (let draw = 0; draw < cluster.length; draw += 1) {
        clusterTotal += pick(cluster);
      }
      total += clusterTotal / cluster.length;
    }
    estimates.push(total / clusters.length);
  }
  estimates.sort((left, right) => left - right);
  return [
    estimates[Math.floor(0.025 * (iterations - 1))],
    estimates[Math.ceil(0.975 * (iterations - 1))],
  ];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parsePositiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
