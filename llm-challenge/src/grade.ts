import { promises as fs } from "node:fs";
import path from "node:path";
import { parsePositiveInteger, rejectInlineValue, splitOption } from "./args";
import { extractTerminalCommands } from "./artifact-summary";
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
import { artifactPathsIn, reportPath, resolveExistingReportPath } from "./report";
import { loadRubric, type Rubric } from "./rubric";
import { INFRASTRUCTURE_FAILURE_KINDS } from "./types";
import {
  createRunId,
  isObject,
  readJsonLines,
  runWithConcurrency,
  tailText,
  toContainerName,
} from "./utils";
import type {
  ChallengeRunReport,
  ProblemGroup,
  SdkProfile,
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
  report: string;
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

export type GradeVariant = {
  agent: SolverAgent;
  model: string;
  effort: string;
  profile: SdkProfile;
  sdkRef: string;
  reports: string[];
} & GradeSummary;

type GradeSource = { path: string; relativePath: string; report: StoredChallengeReport };

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
    const [name, inlineValue] = splitOption(token);
    if (!name.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    switch (name) {
      case "--no-preflight":
        rejectInlineValue(name, inlineValue);
        options.preflight = false;
        continue;
      case "--allow-self-judge":
        rejectInlineValue(name, inlineValue);
        options.allowSelfJudge = true;
        continue;
      default:
        break;
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
  if (INFRASTRUCTURE_FAILURE_KINDS.has(failureKind)) {
    return { status: "excluded", reason: `solver ${failureKind}` };
  }
  if (hasBlockingVerificationError(options.checks)) {
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

function hasBlockingVerificationError(checks: VerificationCheck[]): boolean {
  return checks.some((check) => check.scope === "common" && check.outcome === "error");
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
        passValues: scored
          .map((metrics) => metrics.pass as number)
          .toSorted((left, right) => left - right),
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

export function summarizeVariants(
  sources: Array<Pick<GradeSource, "relativePath" | "report">>,
  grades: RunGrade[],
): GradeVariant[] {
  const variants = new Map<string, Omit<GradeVariant, keyof GradeSummary>>();
  for (const { relativePath, report } of sources) {
    const settings = {
      agent: report.agent ?? "codex",
      model: report.model,
      effort: report.effort,
      profile: report.requestedProfile,
      sdkRef: report.sdkRef,
    };
    const key = JSON.stringify(Object.values(settings));
    const variant = variants.get(key);
    if (variant === undefined) {
      variants.set(key, { ...settings, reports: [relativePath] });
    } else {
      variant.reports.push(relativePath);
    }
  }
  return [...variants.values()].map((variant) => ({
    ...variant,
    ...summarizeGrades(grades.filter((grade) => variant.reports.includes(grade.report))),
  }));
}

export function selectGradedRuns<Source extends { report: StoredChallengeReport }>(
  sources: Source[],
): Array<{ source: Source; run: ChallengeRunReport }> {
  const replaced = new Set(
    sources.flatMap((source) =>
      source.report.runs.flatMap((run) =>
        run.replaces?.artifactDir && run.replaces.artifactDir !== run.artifactDir
          ? [run.replaces.artifactDir]
          : [],
      ),
    ),
  );
  return sources.flatMap((source) =>
    source.report.runs
      .filter((run) => !replaced.has(run.artifactDir))
      .map((run) => ({ source, run })),
  );
}

export function gradeRunLocation(options: {
  outputDir: string;
  gradeId: string;
  reportRunId: string;
  run: Pick<ChallengeRunReport, "group" | "problemId" | "runIndex">;
}): { dir: string; containerName: string } {
  const { run } = options;
  return {
    dir: path.join(
      options.outputDir,
      "runs",
      options.reportRunId,
      run.group,
      run.problemId,
      `run-${run.runIndex}`,
    ),
    containerName: toContainerName(
      "grade",
      options.gradeId,
      options.reportRunId,
      run.group,
      run.problemId,
      run.runIndex,
    ),
  };
}

export async function loadGradeSources(
  packageRoot: string,
  reportFiles: string[],
): Promise<GradeSource[]> {
  const resolvedPaths = await Promise.all(
    reportFiles.map(async (reportFile) =>
      path.resolve(await resolveExistingReportPath(packageRoot, reportFile)),
    ),
  );
  return await Promise.all(
    [...new Set(resolvedPaths)].map(async (resolved) => ({
      path: resolved,
      relativePath: reportPath(packageRoot, resolved),
      report: JSON.parse(await fs.readFile(resolved, "utf8")) as StoredChallengeReport,
    })),
  );
}

export async function gradeCommand(argv: string[], packageRoot: string): Promise<void> {
  const options = parseGradeArgs(argv);
  const sources = await loadGradeSources(packageRoot, options.reports);
  const selfJudged = sources.filter(
    (source) =>
      (source.report.agent ?? "codex") === "claude" && source.report.model === options.judgeModel,
  );
  if (selfJudged.length > 0 && !options.allowSelfJudge) {
    throw new Error(
      `${options.judgeModel} would grade its own runs (${selfJudged.map((source) => source.relativePath).join(", ")}); pass another --judge-model for every report in the comparison, or --allow-self-judge`,
    );
  }

  const runs = selectGradedRuns(sources);
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
      report: source.relativePath,
      reportRunId: source.report.runId,
      packageRoot,
      gradeId,
      outputDir,
      run,
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
  const variants = summarizeVariants(sources, grades);
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
          path: source.relativePath,
          runId: source.report.runId,
          agent: source.report.agent ?? "codex",
          model: source.report.model,
          effort: source.report.effort,
          sdkRef: source.report.sdkRef,
          profile: source.report.requestedProfile,
        })),
        variants,
        ...summary,
      },
      null,
      2,
    )}\n`,
  );
  if (variants.length > 1) {
    for (const variant of variants) {
      console.log(
        `${variant.agent}/${variant.model}/${variant.effort} ${variant.profile} ${variant.sdkRef.slice(0, 12)}: pass rate ${formatPassRate(variant)}`,
      );
    }
  }
  console.log(`Pass rate ${formatPassRate(summary)}`);
  console.log(`Grades ${reportPath(packageRoot, outputDir)}`);
}

function formatPassRate(summary: GradeSummary): string {
  const { passRate, ci95, problems, scoredRuns, excludedRuns, errorRuns } = summary.overall;
  const [low, high] = ci95;
  return `${(passRate * 100).toFixed(1)}% (95% CI ${(low * 100).toFixed(1)}-${(high * 100).toFixed(1)}%) over ${problems} problems, ${scoredRuns} scored runs; excluded=${excludedRuns} error=${errorRuns}`;
}

async function gradeRun(options: {
  agent: SolverAgent;
  report: string;
  reportRunId: string;
  packageRoot: string;
  gradeId: string;
  outputDir: string;
  run: ChallengeRunReport;
  rubric?: { rubric: Rubric; hash: string } | Error;
  options: GradeOptions;
  runtime: ReturnType<typeof getClaudeRuntimeConfig>;
  token: string;
}): Promise<RunGrade> {
  const { run } = options;
  const base: RunGrade = {
    report: options.report,
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
  const artifactPaths = artifactPathsIn(path.resolve(options.packageRoot, run.artifactDir));
  const checks = await readVerificationChecks(artifactPaths.verificationSummaryPath);
  if (checks === undefined) {
    return { ...base, reason: "verification summary missing" };
  }
  if (hasBlockingVerificationError(checks)) {
    return {
      ...base,
      ...decideRunGrade({ failureKind: run.failureKind, checks, judge: undefined }),
    };
  }

  try {
    const location = gradeRunLocation({
      outputDir: options.outputDir,
      gradeId: options.gradeId,
      reportRunId: options.reportRunId,
      run,
    });
    const workspaceDir = path.join(location.dir, "workspace");
    const evidenceDir = path.join(location.dir, "evidence");
    await fs.mkdir(evidenceDir, { recursive: true });
    const workspace = await prepareJudgeWorkspace(artifactPaths.worktreePath, workspaceDir);
    await fs.writeFile(
      path.join(evidenceDir, "commands.json"),
      `${JSON.stringify(
        await buildCommandEvidence({ agent: options.agent, tracePath: artifactPaths.tracePath }),
        null,
        2,
      )}\n`,
    );
    const claims = options.rubric.rubric.claims;
    const prompt = buildJudgePrompt({
      taskPrompt: await fs.readFile(artifactPaths.promptPath, "utf8"),
      claims,
      workspace,
    });
    await fs.writeFile(path.join(location.dir, "judge-prompt.md"), prompt);
    const tracePath = path.join(location.dir, "judge.trace.jsonl");
    const result = await runJudgeInPodman({
      containerName: location.containerName,
      workspaceDir,
      evidenceDir,
      prompt,
      model: options.options.judgeModel,
      effort: options.options.judgeEffort,
      schema: buildJudgeOutputSchema(claims.map((claim) => claim.id)),
      runtime: options.runtime,
      token: options.token,
      stdoutPath: path.join(location.dir, "judge.stdout.log"),
      stderrPath: path.join(location.dir, "judge.stderr.log"),
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
    await fs.writeFile(
      path.join(location.dir, "grade.json"),
      `${JSON.stringify(grade, null, 2)}\n`,
    );
    return grade;
  } catch (error) {
    return { ...base, reason: error instanceof Error ? error.message : String(error) };
  }
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
}): Promise<CommandEvidence[]> {
  const events = await readJsonLines(options.tracePath);
  const commands: Array<{ command: string; exitCode?: number; status?: string; output?: string }> =
    options.agent === "claude"
      ? summarizeClaudeTrace(events).commands
      : extractTerminalCommands(events);
  return commands.map((command) => ({
    command: command.command,
    exitCode: command.exitCode,
    status: command.status,
    ...(command.output === undefined
      ? {}
      : { outputTail: tailText(command.output, COMMAND_OUTPUT_TAIL) }),
  }));
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
