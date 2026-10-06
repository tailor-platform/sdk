import { isObject } from "./utils";

const SYNTHETIC_MODEL = "<synthetic>";

export type TraceCommand = {
  command: string;
  exitCode?: number;
  status: "completed" | "failed" | "incomplete";
  output?: string;
};

export type ClaudeResultSummary = {
  subtype?: string;
  isError?: boolean;
  numTurns?: number;
  durationMs?: number;
  totalCostUsd?: number;
  apiErrorStatus?: number | null;
  errorText?: string;
  structuredOutput?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
};

export type ClaudeTraceSummary = {
  claudeCodeVersion?: string;
  requestedModel?: string;
  tools: string[];
  servedModels: string[];
  commands: TraceCommand[];
  toolCalls: number;
  result?: ClaudeResultSummary;
  rateLimitRejected: boolean;
};

export function summarizeClaudeTrace(events: unknown[]): ClaudeTraceSummary {
  const summary: ClaudeTraceSummary = {
    tools: [],
    servedModels: [],
    commands: [],
    toolCalls: 0,
    rateLimitRejected: false,
  };
  const pendingCommands = new Map<string, TraceCommand>();
  const servedModels = new Set<string>();

  for (const event of events) {
    if (!isObject(event)) {
      continue;
    }
    if (event.type === "system" && event.subtype === "init") {
      summary.claudeCodeVersion = optionalString(event.claude_code_version);
      summary.requestedModel = optionalString(event.model);
      summary.tools = Array.isArray(event.tools)
        ? event.tools.filter((tool): tool is string => typeof tool === "string")
        : [];
      continue;
    }
    if (event.type === "rate_limit_event") {
      const info = isObject(event.rate_limit_info) ? event.rate_limit_info : {};
      summary.rateLimitRejected ||= info.status === "rejected";
      continue;
    }
    if (event.type === "result") {
      summary.result = readResult(event);
      continue;
    }

    const message = isObject(event.message) ? event.message : undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    if (event.type === "assistant") {
      if (
        event.parent_tool_use_id === null &&
        typeof message?.model === "string" &&
        message.model !== SYNTHETIC_MODEL
      ) {
        servedModels.add(message.model);
      }
      for (const block of content) {
        if (!isObject(block) || block.type !== "tool_use") {
          continue;
        }
        summary.toolCalls += 1;
        const input = isObject(block.input) ? block.input : {};
        if (
          block.name === "Bash" &&
          typeof input.command === "string" &&
          typeof block.id === "string"
        ) {
          const command: TraceCommand = { command: input.command, status: "incomplete" };
          pendingCommands.set(block.id, command);
          summary.commands.push(command);
        }
      }
      continue;
    }
    if (event.type === "user") {
      for (const block of content) {
        if (
          !isObject(block) ||
          block.type !== "tool_result" ||
          typeof block.tool_use_id !== "string"
        ) {
          continue;
        }
        const command = pendingCommands.get(block.tool_use_id);
        if (command === undefined) {
          continue;
        }
        pendingCommands.delete(block.tool_use_id);
        const output = toolResultText(block.content);
        command.output = output;
        if (block.is_error === true) {
          command.status = "failed";
          const exitCode = /^Exit code (\d+)/.exec(output)?.[1];
          if (exitCode !== undefined) {
            command.exitCode = Number(exitCode);
          }
        } else {
          command.status = "completed";
          command.exitCode = 0;
        }
      }
    }
  }

  summary.servedModels = [...servedModels];
  return summary;
}

const DATED_SNAPSHOT_SUFFIX = /-\d{8}$/;
const MODEL_VARIANT_SUFFIX = /\[[^\]]*\]$/;

export function findServedModelMismatches(
  requestedModel: string,
  servedModels: string[],
): string[] {
  if (!requestedModel.startsWith("claude-")) {
    return [];
  }
  return servedModels.filter((served) => !isSameClaudeModel(requestedModel, served));
}

export function isSameClaudeModel(left: string, right: string): boolean {
  return baseClaudeModel(left) === baseClaudeModel(right);
}

function baseClaudeModel(model: string): string {
  return model.replace(MODEL_VARIANT_SUFFIX, "").replace(DATED_SNAPSHOT_SUFFIX, "");
}

function readResult(event: Record<string, unknown>): ClaudeResultSummary {
  const usage = isObject(event.usage) ? event.usage : undefined;
  return {
    subtype: optionalString(event.subtype),
    isError: typeof event.is_error === "boolean" ? event.is_error : undefined,
    numTurns: optionalNumber(event.num_turns),
    durationMs: optionalNumber(event.duration_ms),
    totalCostUsd: optionalNumber(event.total_cost_usd),
    apiErrorStatus:
      typeof event.api_error_status === "number" || event.api_error_status === null
        ? event.api_error_status
        : undefined,
    errorText: event.is_error === true ? optionalString(event.result) : undefined,
    structuredOutput: event.structured_output,
    usage:
      usage === undefined
        ? undefined
        : {
            inputTokens: optionalNumber(usage.input_tokens),
            outputTokens: optionalNumber(usage.output_tokens),
            cacheReadInputTokens: optionalNumber(usage.cache_read_input_tokens),
            cacheCreationInputTokens: optionalNumber(usage.cache_creation_input_tokens),
          },
  };
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => (isObject(block) && typeof block.text === "string" ? block.text : ""))
      .join("");
  }
  return "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
