import type { SolveAgent } from "./solver/types";

/**
 * Legacy agent ids that may still appear inside historical `results/*.json`
 * model labels. Kept for backward-compatible parsing so `analyze --groups` and
 * `--trend` can still surface those reports — but never produced by the OSS
 * runner.
 */
type LegacyAgent = "claude" | "codex";

/** Default Ollama model id when no `--model` is supplied. */
const DEFAULT_OSS_MODEL = "gpt-oss:20b";

export function normalizeModel(model?: string): string {
  if (!model || model === "default") {
    return DEFAULT_OSS_MODEL;
  }
  return model;
}

export function formatSolveModelLabel(model?: string): string {
  return `oss:${model ?? DEFAULT_OSS_MODEL}`;
}

/**
 * Parse a `"<agent>:<model>"` label from a historical report. Recognises the
 * legacy `"claude:*"` / `"codex:*"` prefixes used in pre-OSS reports so
 * analyze tooling can still group / render them alongside fresh `"oss:*"`
 * entries.
 */
export function parseSolveModelLabel(label?: string): {
  agent: SolveAgent | LegacyAgent;
  model?: string;
} {
  if (!label) {
    return { agent: "oss", model: DEFAULT_OSS_MODEL };
  }
  const [prefix, ...rest] = label.split(":");
  if ((prefix === "claude" || prefix === "codex" || prefix === "oss") && rest.length > 0) {
    return {
      agent: prefix,
      model: rest.join(":"),
    };
  }
  // Backward compatibility: very old reports stored only the model name.
  // Tag them as "claude" since that was the sole solver at the time.
  return { agent: "claude", model: label };
}
