import { spawn } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { isObject, pathExistsSync, tailText } from "./utils";
import { listWorkspaceFiles } from "./workspace-files";
import type { Problem } from "./types";

export type VerificationOutcome = "satisfied" | "unsatisfied" | "skipped" | "error";

export type VerificationCheckResult = {
  id: string;
  scope: "common" | "problem";
  kind: "assertion" | "command";
  description: string;
  outcome: VerificationOutcome;
  command?: string;
  exitCode?: number;
  durationMs?: number;
  outputTail?: string;
  observations?: string[];
  error?: string;
};

export type VerificationSummary = {
  schemaVersion: 1;
  generatedAt: string;
  problemId: string;
  group: Problem["group"];
  runIndex: number;
  checks: VerificationCheckResult[];
};

type VerifySpec = {
  schemaVersion?: 1;
  checks?: VerifySpecCheck[];
};

type VerifySpecCheck =
  | {
      id: string;
      kind: "file-exists";
      description?: string;
      path: string;
    }
  | {
      id: string;
      kind: "file-glob";
      description?: string;
      glob: string;
      minCount?: number;
    }
  | {
      id: string;
      kind: "content-match";
      description?: string;
      glob: string;
      pattern: string;
      flags?: string;
      minMatches?: number;
    };

const TYPESCRIPT_NO_EMIT_COMMAND = "node node_modules/typescript/bin/tsc --noEmit --pretty false";
const TYPECHECK_TIMEOUT_MS = 120_000;

export async function writeVerificationSummary(options: {
  problem: Problem;
  runIndex: number;
  worktreePath: string;
  verificationSummaryPath: string;
  verificationStdoutPath: string;
  verificationStderrPath: string;
}): Promise<VerificationSummary> {
  await Promise.all([
    fs.mkdir(path.dirname(options.verificationSummaryPath), { recursive: true }),
    fs.mkdir(path.dirname(options.verificationStdoutPath), { recursive: true }),
    fs.mkdir(path.dirname(options.verificationStderrPath), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(options.verificationStdoutPath, ""),
    fs.writeFile(options.verificationStderrPath, ""),
  ]);

  const files = await listWorkspaceFiles(options.worktreePath);
  const checks = [
    ...commonChecks(options.problem, options.worktreePath, files),
    ...(await runProblemChecks(options.problem, options.worktreePath, files)),
  ];
  const completedChecks: VerificationCheckResult[] = [];
  for (const check of checks) {
    completedChecks.push(
      check.kind === "command"
        ? await runCommandCheck(check, options.worktreePath, {
            stdoutPath: options.verificationStdoutPath,
            stderrPath: options.verificationStderrPath,
          })
        : check,
    );
  }

  const summary: VerificationSummary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    problemId: options.problem.id,
    group: options.problem.group,
    runIndex: options.runIndex,
    checks: completedChecks,
  };
  await fs.writeFile(options.verificationSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function commonChecks(
  problem: Problem,
  worktreePath: string,
  files: string[],
): VerificationCheckResult[] {
  const checks: VerificationCheckResult[] = [
    fileExistsCheck("workspace-package-json", "package.json", worktreePath, "package.json exists"),
  ];
  if (problem.group === "sdk-api") {
    checks.push(
      fileExistsCheck(
        "sdk-api-tailor-config",
        "tailor.config.ts",
        worktreePath,
        "sdk-api workspace exposes a Tailor config file",
      ),
    );
  }

  if (files.some((file) => file.endsWith(".ts"))) {
    checks.push({
      id: "typescript-no-emit",
      scope: "common",
      kind: "command",
      description: "TypeScript sources compile without emitting files",
      outcome: "skipped",
      command: TYPESCRIPT_NO_EMIT_COMMAND,
    });
  } else {
    checks.push({
      id: "typescript-no-emit",
      scope: "common",
      kind: "assertion",
      description: "TypeScript sources compile without emitting files",
      outcome: "skipped",
      observations: ["no TypeScript source files were present"],
    });
  }
  return checks;
}

async function runProblemChecks(
  problem: Problem,
  worktreePath: string,
  files: string[],
): Promise<VerificationCheckResult[]> {
  if (problem.verifyPath === undefined) {
    return [];
  }
  let spec: VerifySpec;
  try {
    spec = JSON.parse(await fs.readFile(problem.verifyPath, "utf8")) as VerifySpec;
  } catch (error) {
    return [
      {
        id: "problem-verify-spec",
        scope: "problem",
        kind: "assertion",
        description: "Problem verification spec can be read",
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  if (!Array.isArray(spec.checks)) {
    return [];
  }
  return spec.checks.map((check) => evaluateProblemCheck(check, worktreePath, files));
}

function evaluateProblemCheck(
  check: VerifySpecCheck,
  worktreePath: string,
  files: string[],
): VerificationCheckResult {
  try {
    if (!isObject(check) || typeof check.id !== "string" || typeof check.kind !== "string") {
      return invalidProblemCheck("unknown", "Problem check must include string id and kind");
    }
    if (check.kind === "file-exists") {
      return fileExistsCheck(
        check.id,
        check.path,
        worktreePath,
        check.description ?? `${check.path} exists`,
        "problem",
      );
    }
    if (check.kind === "file-glob") {
      return fileGlobCheck(check, files);
    }
    if (check.kind === "content-match") {
      return contentMatchCheck(check, worktreePath, files);
    }
    const unknownCheck = check as { id: string; kind: string };
    return invalidProblemCheck(unknownCheck.id, `Unknown problem check kind: ${unknownCheck.kind}`);
  } catch (error) {
    return {
      id: typeof check.id === "string" ? check.id : "unknown",
      scope: "problem",
      kind: "assertion",
      description: "Problem check encountered an error",
      outcome: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function fileExistsCheck(
  id: string,
  relativePath: string,
  worktreePath: string,
  description: string,
  scope: VerificationCheckResult["scope"] = "common",
): VerificationCheckResult {
  const absolutePath = path.join(worktreePath, relativePath);
  return {
    id,
    scope,
    kind: "assertion",
    description,
    outcome: pathExistsSync(absolutePath) ? "satisfied" : "unsatisfied",
    observations: [`path: ${relativePath}`],
  };
}

function fileGlobCheck(
  check: Extract<VerifySpecCheck, { kind: "file-glob" }>,
  files: string[],
): VerificationCheckResult {
  const minCount = check.minCount ?? 1;
  const globRegex = globToRegExp(check.glob);
  const matches = files.filter((file) => globRegex.test(file));
  return {
    id: check.id,
    scope: "problem",
    kind: "assertion",
    description: check.description ?? `${check.glob} matches at least ${minCount} file(s)`,
    outcome: matches.length >= minCount ? "satisfied" : "unsatisfied",
    observations: [`matches: ${matches.length}`, ...matches.slice(0, 10)],
  };
}

function contentMatchCheck(
  check: Extract<VerifySpecCheck, { kind: "content-match" }>,
  worktreePath: string,
  files: string[],
): VerificationCheckResult {
  const minMatches = check.minMatches ?? 1;
  const regex = new RegExp(check.pattern, check.flags ?? "");
  const globRegex = globToRegExp(check.glob);
  const matchedFiles: string[] = [];
  for (const file of files.filter((candidate) => globRegex.test(candidate))) {
    const text = readFileSync(path.join(worktreePath, file), "utf8");
    regex.lastIndex = 0;
    if (regex.test(text)) {
      matchedFiles.push(file);
    }
  }
  return {
    id: check.id,
    scope: "problem",
    kind: "assertion",
    description: check.description ?? `${check.glob} content matches ${check.pattern}`,
    outcome: matchedFiles.length >= minMatches ? "satisfied" : "unsatisfied",
    observations: [`matches: ${matchedFiles.length}`, ...matchedFiles.slice(0, 10)],
  };
}

function invalidProblemCheck(id: string, message: string): VerificationCheckResult {
  return {
    id,
    scope: "problem",
    kind: "assertion",
    description: "Problem check is valid",
    outcome: "error",
    error: message,
  };
}

async function runCommandCheck(
  check: VerificationCheckResult,
  worktreePath: string,
  logPaths: { stdoutPath: string; stderrPath: string },
): Promise<VerificationCheckResult> {
  if (check.command === undefined) {
    return check;
  }
  const startedAt = Date.now();
  const result = await runProcess(check.command, worktreePath, TYPECHECK_TIMEOUT_MS);
  await Promise.all([
    appendCommandLog(logPaths.stdoutPath, check.command, result.stdout),
    appendCommandLog(logPaths.stderrPath, check.command, result.stderr),
  ]);
  return {
    ...check,
    outcome: result.exitCode === 0 ? "satisfied" : "unsatisfied",
    exitCode: result.exitCode,
    durationMs: Date.now() - startedAt,
    outputTail: tailText(`${result.stdout}${result.stderr}`),
    observations: result.timedOut ? ["command timed out"] : undefined,
  };
}

async function runProcess(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return await new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      }
    }, timeoutMs);
    timeout.unref();

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout: "", stderr: error.message, exitCode: 127, timedOut });
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: exitCode ?? 1,
        timedOut,
      });
    });
  });
}

async function appendCommandLog(logPath: string, command: string, output: string): Promise<void> {
  if (output.length === 0) {
    return;
  }
  await fs.appendFile(logPath, `$ ${command}\n${output}${output.endsWith("\n") ? "" : "\n"}`);
}

function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      if (glob[index + 2] === "/") {
        pattern += "(?:.*/)?";
        index += 2;
        continue;
      }
      pattern += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      pattern += "[^/]*";
      continue;
    }
    pattern += escapeRegExp(char);
  }
  return new RegExp(`^${pattern}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
