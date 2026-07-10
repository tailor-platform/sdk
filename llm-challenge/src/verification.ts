import { spawn } from "node:child_process";
import { constants as fsConstants, promises as fs, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { DEFAULT_CODEX_IMAGE } from "./runner";
import { tailText, toPosix } from "./utils";
import {
  BUILT_IN_VERIFICATION_CHECK_IDS,
  parseVerificationSpec,
  type VerifySpec,
  type VerifySpecCheck,
} from "./verification-spec";
import { isExcludedWorkspacePath, listWorkspaceFiles } from "./workspace-files";
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

const TYPESCRIPT_NO_EMIT_COMMAND =
  "podman run [isolated verifier] node /verifier/typescript/bin/tsc --noEmit --incremental false --pretty false";
const TYPESCRIPT_VERIFIER_SCRIPT =
  "exec node /verifier/typescript/bin/tsc --noEmit --incremental false --pretty false";
const TYPECHECK_TIMEOUT_MS = 120_000;
const PROCESS_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const CONTENT_FILE_LIMIT = 100;
const CONTENT_FILE_BYTES_LIMIT = 1024 * 1024;
const CONTENT_TOTAL_BYTES_LIMIT = 5 * 1024 * 1024;
const CONTENT_MATCH_TIMEOUT_MS = 1_000;
const TRUSTED_TYPESCRIPT_PATH = realpathSync(
  path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
);
const CONTENT_WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
try {
  const regex = new RegExp(workerData.pattern, workerData.flags);
  const matches = [];
  for (let index = 0; index < workerData.contents.length; index += 1) {
    regex.lastIndex = 0;
    if (regex.test(workerData.contents[index])) matches.push(index);
  }
  parentPort.postMessage({ matches });
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
`;

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

  const files = (await listWorkspaceFiles(options.worktreePath)).filter(
    (file) => resolveWorkspaceEvidenceFile(options.worktreePath, file) !== undefined,
  );
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
    fileExistsCheck(
      BUILT_IN_VERIFICATION_CHECK_IDS.workspacePackageJson,
      "package.json",
      worktreePath,
      "package.json exists",
    ),
  ];
  if (problem.group === "sdk-api") {
    checks.push(
      fileExistsCheck(
        BUILT_IN_VERIFICATION_CHECK_IDS.sdkApiTailorConfig,
        "tailor.config.ts",
        worktreePath,
        "sdk-api workspace exposes a Tailor config file",
      ),
    );
  }

  if (files.some((file) => file.endsWith(".ts"))) {
    checks.push({
      id: BUILT_IN_VERIFICATION_CHECK_IDS.typescriptNoEmit,
      scope: "common",
      kind: "command",
      description: "TypeScript sources compile without emitting files",
      outcome: "skipped",
      command: TYPESCRIPT_NO_EMIT_COMMAND,
    });
  } else {
    checks.push({
      id: BUILT_IN_VERIFICATION_CHECK_IDS.typescriptNoEmit,
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
    spec = parseVerificationSpec(await fs.readFile(problem.verifyPath, "utf8"));
  } catch (error) {
    return [
      {
        id: BUILT_IN_VERIFICATION_CHECK_IDS.problemVerifySpec,
        scope: "problem",
        kind: "assertion",
        description: "Problem verification spec can be read and validated",
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  const results: VerificationCheckResult[] = [];
  for (const check of spec.checks) {
    results.push(await evaluateProblemCheck(check, worktreePath, files));
  }
  return results;
}

async function evaluateProblemCheck(
  check: VerifySpecCheck,
  worktreePath: string,
  files: string[],
): Promise<VerificationCheckResult> {
  try {
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
      return await contentMatchCheck(check, worktreePath, files);
    }
    if (check.kind === "content-absent") {
      return await contentAbsentCheck(check, worktreePath, files);
    }
    throw new Error("Unsupported problem check kind");
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
  const absolutePath = resolveWorkspaceEvidenceFile(worktreePath, relativePath);
  return {
    id,
    scope,
    kind: "assertion",
    description,
    outcome: absolutePath !== undefined ? "satisfied" : "unsatisfied",
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

async function contentMatchCheck(
  check: Extract<VerifySpecCheck, { kind: "content-match" }>,
  worktreePath: string,
  files: string[],
): Promise<VerificationCheckResult> {
  const minMatches = check.minMatches ?? 1;
  const matchedFiles = await matchingContentFiles(check, worktreePath, files);
  return {
    id: check.id,
    scope: "problem",
    kind: "assertion",
    description: check.description ?? `${check.glob} content matches ${check.pattern}`,
    outcome: matchedFiles.length >= minMatches ? "satisfied" : "unsatisfied",
    observations: [`matchedFiles: ${matchedFiles.length}`, ...matchedFiles.slice(0, 10)],
  };
}

async function contentAbsentCheck(
  check: Extract<VerifySpecCheck, { kind: "content-absent" }>,
  worktreePath: string,
  files: string[],
): Promise<VerificationCheckResult> {
  const matchedFiles = await matchingContentFiles(check, worktreePath, files);
  return {
    id: check.id,
    scope: "problem",
    kind: "assertion",
    description: check.description ?? `${check.glob} content does not match ${check.pattern}`,
    outcome: matchedFiles.length === 0 ? "satisfied" : "unsatisfied",
    observations: [`matchedFiles: ${matchedFiles.length}`, ...matchedFiles.slice(0, 10)],
  };
}

async function matchingContentFiles(
  check: Extract<VerifySpecCheck, { kind: "content-match" | "content-absent" }>,
  worktreePath: string,
  files: string[],
): Promise<string[]> {
  const globRegex = globToRegExp(check.glob);
  const candidates = files.filter((candidate) => globRegex.test(candidate));
  if (candidates.length > CONTENT_FILE_LIMIT) {
    throw new Error(
      `content evidence limit exceeded: ${candidates.length} files exceeds ${CONTENT_FILE_LIMIT}`,
    );
  }

  const evidenceFiles: string[] = [];
  const contents: string[] = [];
  let totalBytes = 0;
  for (const file of candidates) {
    const absolutePath = resolveWorkspaceEvidenceFile(worktreePath, file);
    if (absolutePath === undefined) {
      continue;
    }
    const content = await readBoundedContentFile(absolutePath);
    totalBytes += content.byteLength;
    if (totalBytes > CONTENT_TOTAL_BYTES_LIMIT) {
      throw new Error(
        `content evidence limit exceeded: total bytes exceed ${CONTENT_TOTAL_BYTES_LIMIT}`,
      );
    }
    evidenceFiles.push(file);
    contents.push(content.text);
  }

  const matchedIndexes = await matchContentInWorker(check.pattern, check.flags ?? "", contents);
  return matchedIndexes.map((index) => evidenceFiles[index]).filter((file) => file !== undefined);
}

async function readBoundedContentFile(
  absolutePath: string,
): Promise<{ text: string; byteLength: number }> {
  const file = await fs.open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) {
      throw new Error("content evidence limit rejected a non-regular file");
    }
    const buffer = Buffer.alloc(CONTENT_FILE_BYTES_LIMIT + 1);
    let byteLength = 0;
    while (byteLength < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        byteLength,
        buffer.length - byteLength,
        byteLength,
      );
      if (bytesRead === 0) {
        break;
      }
      byteLength += bytesRead;
    }
    if (byteLength > CONTENT_FILE_BYTES_LIMIT) {
      throw new Error(
        `content evidence limit exceeded: file exceeds ${CONTENT_FILE_BYTES_LIMIT} bytes`,
      );
    }
    return {
      text: buffer.subarray(0, byteLength).toString("utf8"),
      byteLength,
    };
  } finally {
    await file.close();
  }
}

async function matchContentInWorker(
  pattern: string,
  flags: string,
  contents: string[],
): Promise<number[]> {
  return await new Promise((resolve, reject) => {
    const worker = new Worker(CONTENT_WORKER_SOURCE, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 32 },
      workerData: { pattern, flags, contents },
    });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      void worker.terminate();
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() =>
        reject(
          new Error(`content regular expression timed out after ${CONTENT_MATCH_TIMEOUT_MS}ms`),
        ),
      );
    }, CONTENT_MATCH_TIMEOUT_MS);

    worker.on("message", (result: { matches?: number[]; error?: string }) => {
      finish(() => {
        if (result.error !== undefined) {
          reject(new Error(result.error));
        } else {
          resolve(result.matches ?? []);
        }
      });
    });
    worker.on("error", (error) => finish(() => reject(error)));
    worker.on("exit", (exitCode) => {
      if (exitCode !== 0) {
        finish(() => reject(new Error(`content worker exited with code ${exitCode}`)));
      }
    });
  });
}

function resolveWorkspaceEvidenceFile(
  worktreePath: string,
  relativePath: string,
): string | undefined {
  const absolutePath = path.join(worktreePath, relativePath);
  try {
    const realWorktreePath = realpathSync(worktreePath);
    const realAbsolutePath = realpathSync(absolutePath);
    const resolvedRelativePath = path.relative(realWorktreePath, realAbsolutePath);
    if (
      resolvedRelativePath === ".." ||
      resolvedRelativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(resolvedRelativePath)
    ) {
      return undefined;
    }
    if (
      isExcludedWorkspacePath(toPosix(resolvedRelativePath)) ||
      !statSync(realAbsolutePath).isFile()
    ) {
      return undefined;
    }
    return realAbsolutePath;
  } catch {
    return undefined;
  }
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
  const result = await runProcess(
    "podman",
    typeScriptVerifierArgs(worktreePath),
    worktreePath,
    TYPECHECK_TIMEOUT_MS,
  );
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
    observations: [
      ...(result.timedOut ? ["command timed out"] : []),
      ...(result.outputTruncated ? ["command output truncated"] : []),
    ],
  };
}

function typeScriptVerifierArgs(worktreePath: string): string[] {
  return [
    "run",
    "--rm",
    "--network=none",
    "--cap-drop=all",
    "--security-opt=no-new-privileges",
    "--memory=1g",
    "--pids-limit=256",
    "--cpus=2",
    "-v",
    `${worktreePath}:/workspace:ro,Z`,
    "-v",
    `${TRUSTED_TYPESCRIPT_PATH}:/verifier/typescript:ro,z`,
    "-w",
    "/workspace",
    "--entrypoint",
    "/bin/bash",
    DEFAULT_CODEX_IMAGE,
    "-lc",
    TYPESCRIPT_VERIFIER_SCRIPT,
  ];
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  outputTruncated: boolean;
}> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputTruncated = false;
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

    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = PROCESS_OUTPUT_LIMIT_BYTES - stdoutBytes;
      if (remaining > 0) {
        stdout.push(chunk.subarray(0, remaining));
        stdoutBytes += Math.min(chunk.length, remaining);
      }
      outputTruncated ||= chunk.length > remaining;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = PROCESS_OUTPUT_LIMIT_BYTES - stderrBytes;
      if (remaining > 0) {
        stderr.push(chunk.subarray(0, remaining));
        stderrBytes += Math.min(chunk.length, remaining);
      }
      outputTruncated ||= chunk.length > remaining;
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        stdout: "",
        stderr: error.message,
        exitCode: 127,
        timedOut,
        outputTruncated,
      });
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
        outputTruncated,
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
