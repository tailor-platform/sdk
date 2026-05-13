import type { SolveAgent } from "./solver/types";

export function normalizeModelForAgent(agent: SolveAgent, model?: string): string | undefined {
  if (agent === "codex" && (!model || model === "default")) {
    return undefined;
  }
  return model;
}

export function formatSolveModelLabel(agent: SolveAgent, model?: string): string {
  const modelLabel = model ?? (agent === "claude" ? "sonnet" : "default");
  return `${agent}:${modelLabel}`;
}

export function parseSolveModelLabel(label?: string): { agent: SolveAgent; model?: string } {
  if (!label) {
    return { agent: "claude", model: "sonnet" };
  }
  const [prefix, ...rest] = label.split(":");
  if ((prefix === "claude" || prefix === "codex") && rest.length > 0) {
    return {
      agent: prefix,
      model: rest.join(":"),
    };
  }
  // Backward compatibility: previous reports stored only model without agent.
  return { agent: "claude", model: label };
}
