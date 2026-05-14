import type { SolveAgent } from "./solver/types";

/** Default Ollama model id when `--agent oss` is selected without `--model`. */
const DEFAULT_OSS_MODEL = "gpt-oss:20b";

export function normalizeModelForAgent(agent: SolveAgent, model?: string): string | undefined {
  if (agent === "codex" && (!model || model === "default")) {
    return undefined;
  }
  if (agent === "oss" && (!model || model === "default")) {
    return DEFAULT_OSS_MODEL;
  }
  return model;
}

export function formatSolveModelLabel(agent: SolveAgent, model?: string): string {
  const modelLabel =
    model ?? (agent === "claude" ? "sonnet" : agent === "oss" ? DEFAULT_OSS_MODEL : "default");
  return `${agent}:${modelLabel}`;
}

export function parseSolveModelLabel(label?: string): { agent: SolveAgent; model?: string } {
  if (!label) {
    return { agent: "claude", model: "sonnet" };
  }
  const [prefix, ...rest] = label.split(":");
  if ((prefix === "claude" || prefix === "codex" || prefix === "oss") && rest.length > 0) {
    return {
      agent: prefix,
      model: rest.join(":"),
    };
  }
  // Backward compatibility: previous reports stored only model without agent.
  return { agent: "claude", model: label };
}
