import { promises as fs } from "node:fs";
import { findServedModelMismatches, summarizeClaudeTrace } from "./claude-trace";
import { runCommand } from "./process";
import { isObject, readJsonLines, tailText } from "./utils";
import { listWorkspaceFiles } from "./workspace-files";
import type { AgentResultSummary, Problem, SolverAgent, SolverFailureKind } from "./types";

export type ArtifactSummary = {
  schemaVersion: 1;
  generatedAt: string;
  problemId: string;
  group: Problem["group"];
  runIndex: number;
  solverExitCode?: number;
  timedOut?: boolean;
  failureKind: SolverFailureKind;
  files: string[];
  gitStatus: string[];
  commands: Array<{
    command: string;
    exitCode?: number;
    status?: string;
  }>;
  failedCommands: Array<{
    command: string;
    exitCode?: number;
    status?: string;
    outputTail?: string;
  }>;
  errors: string[];
  agentResult?: AgentResultSummary;
};

export async function writeArtifactSummary(options: {
  problem: Problem;
  runIndex: number;
  worktreePath: string;
  tracePath: string;
  solverStdoutPath: string;
  solverStderrPath: string;
  artifactSummaryPath: string;
  agent: SolverAgent;
  solverExitCode?: number;
  timedOut?: boolean;
  failureKind: SolverFailureKind;
}): Promise<ArtifactSummary> {
  const traceEvents = await readJsonLines(options.tracePath);
  const claudeTrace = options.agent === "claude" ? summarizeClaudeTrace(traceEvents) : undefined;
  const terminalCommands: CommandEvent[] =
    claudeTrace === undefined
      ? extractTerminalCommands(traceEvents)
      : claudeTrace.commands.map((command) => ({ ...command, terminal: true }));
  const commands = terminalCommands.map((command) => ({
    command: command.command,
    exitCode: command.exitCode,
    status: command.status,
  }));
  const failedCommands = terminalCommands
    .filter((command) => command.status === "failed" || (command.exitCode ?? 0) !== 0)
    .map((command) => ({
      command: command.command,
      exitCode: command.exitCode,
      status: command.status,
      outputTail: command.output === undefined ? undefined : tailText(command.output),
    }));
  const errors =
    claudeTrace === undefined
      ? extractErrors(traceEvents)
      : claudeTrace.result?.errorText === undefined
        ? []
        : [claudeTrace.result.errorText];
  const summary: ArtifactSummary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    problemId: options.problem.id,
    group: options.problem.group,
    runIndex: options.runIndex,
    solverExitCode: options.solverExitCode,
    timedOut: options.timedOut,
    failureKind: options.failureKind,
    files: await listWorkspaceFiles(options.worktreePath),
    gitStatus: await readGitStatus(options.worktreePath),
    commands,
    failedCommands,
    errors,
    agentResult:
      claudeTrace === undefined
        ? undefined
        : {
            toolCalls: claudeTrace.toolCalls,
            servedModels: claudeTrace.servedModels,
            availableSkills: claudeTrace.skills,
            skillInvocations: claudeTrace.skillInvocations,
            subtype: claudeTrace.result?.subtype,
            isError: claudeTrace.result?.isError,
            numTurns: claudeTrace.result?.numTurns,
            durationMs: claudeTrace.result?.durationMs,
            totalCostUsd: claudeTrace.result?.totalCostUsd,
            apiErrorStatus: claudeTrace.result?.apiErrorStatus,
            usage: claudeTrace.result?.usage,
          },
  };
  await fs.writeFile(options.artifactSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

export async function classifySolverFailure(options: {
  agent: SolverAgent;
  requestedModel: string;
  timedOut: boolean;
  solverExitCode?: number;
  tracePath: string;
  solverStdoutPath: string;
  solverStderrPath: string;
}): Promise<SolverFailureKind> {
  if (options.timedOut) {
    return "timeout";
  }
  if (options.agent === "claude") {
    return classifyClaudeRun(
      summarizeClaudeTrace(await readJsonLines(options.tracePath)),
      options.requestedModel,
      options.solverExitCode,
    );
  }
  if (options.solverExitCode === 0) {
    return "none";
  }

  const text = await readAvailableText([
    options.tracePath,
    options.solverStdoutPath,
    options.solverStderrPath,
  ]);
  if (/usage limit|try again at|request to your admin/i.test(text)) {
    return "usage-limit";
  }
  if (
    /\b401 unauthorized\b|not logged in|codex login/i.test(
      await readAvailableText([options.solverStderrPath]),
    )
  ) {
    return "auth";
  }
  if (
    /cannot execute binary file|codex CLI is not installed|Cannot connect to Podman|unable to connect to Podman|auth\.json|npm is unavailable/i.test(
      text,
    )
  ) {
    return "runner-startup";
  }
  if (options.solverExitCode !== undefined) {
    return "solver-nonzero";
  }
  return "unknown";
}

function classifyClaudeRun(
  trace: ReturnType<typeof summarizeClaudeTrace>,
  requestedModel: string,
  solverExitCode: number | undefined,
): SolverFailureKind {
  if (findServedModelMismatches(requestedModel, trace.servedModels).length > 0) {
    return "model-mismatch";
  }
  if (solverExitCode === 0 && trace.result !== undefined && trace.result.isError !== true) {
    return "none";
  }
  const apiErrorStatus = trace.result?.apiErrorStatus;
  if (trace.rateLimitRejected || apiErrorStatus === 429) {
    return "usage-limit";
  }
  if (apiErrorStatus === 401 || apiErrorStatus === 403) {
    return "auth";
  }
  if (typeof apiErrorStatus === "number" && apiErrorStatus >= 500) {
    return "api-error";
  }
  if (trace.result === undefined) {
    return solverExitCode === 0 ? "unknown" : "runner-startup";
  }
  return "solver-nonzero";
}

async function readGitStatus(worktreePath: string): Promise<string[]> {
  try {
    const result = await runCommand("git", ["status", "--short", "--untracked-files=all"], {
      cwd: worktreePath,
    });
    return result.stdout.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

export function extractTerminalCommands(events: unknown[]): CommandEvent[] {
  return events.flatMap((event) => {
    const commandEvent = getCommandEvent(event);
    return commandEvent !== undefined && commandEvent.terminal ? [commandEvent] : [];
  });
}

type CommandEvent = {
  command: string;
  exitCode?: number;
  status?: string;
  output?: string;
  terminal: boolean;
};

function getCommandEvent(event: unknown): CommandEvent | undefined {
  if (isObject(event) && event.type === "exec_command_end") {
    const command = commandText(event);
    if (command === undefined) {
      return undefined;
    }
    const exitCode = typeof event.exit_code === "number" ? event.exit_code : undefined;
    return {
      command,
      exitCode,
      status: typeof event.status === "string" ? event.status : undefined,
      output: typeof event.aggregated_output === "string" ? event.aggregated_output : undefined,
      terminal: true,
    };
  }

  const item = getItem(event);
  if (item?.type !== "command_execution" || typeof item.command !== "string") {
    return undefined;
  }
  const exitCode = typeof item.exit_code === "number" ? item.exit_code : undefined;
  const status = typeof item.status === "string" ? item.status : undefined;
  return {
    command: item.command,
    exitCode,
    status,
    output: typeof item.aggregated_output === "string" ? item.aggregated_output : undefined,
    terminal: exitCode !== undefined || status === "completed" || status === "failed",
  };
}

function commandText(event: Record<string, unknown>): string | undefined {
  if (typeof event.command === "string") {
    return event.command;
  }
  if (typeof event.cmd === "string") {
    return event.cmd;
  }
  return undefined;
}

function extractErrors(events: unknown[]): string[] {
  return events.flatMap((event) => {
    if (!isObject(event)) {
      return [];
    }
    if (event.type === "error" && typeof event.message === "string") {
      return [event.message];
    }
    if (isObject(event.error) && typeof event.error.message === "string") {
      return [event.error.message];
    }
    return [];
  });
}

function getItem(event: unknown): Record<string, unknown> | undefined {
  if (!isObject(event) || !isObject(event.item)) {
    return undefined;
  }
  return event.item;
}

async function readAvailableText(filePaths: string[]): Promise<string> {
  const chunks = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        return await fs.readFile(filePath, "utf8");
      } catch {
        return "";
      }
    }),
  );
  return chunks.join("\n");
}
