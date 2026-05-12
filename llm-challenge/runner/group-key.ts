import type { ChallengeReport } from "./score";
import { parseSolveModelLabel } from "./solve-model";

export type GroupKey = {
  agent: string;
  model: string;
  contextProfile: string;
};

/**
 * Derive an `(agent, model, contextProfile)` grouping key from a report.
 *
 * The `model` field follows three shapes:
 * - Solve runs use `"agent:model"` (e.g. `"claude:sonnet"`, `"codex:default"`).
 * - Rerun-infra reports may store composite labels like
 *   `"claude:opus+codex:default"`; the primary segment wins.
 * - Pre-`agent:` runs stored only the model (e.g. `"sonnet"`); this is the
 *   shape `parseSolveModelLabel` recovers as `{ agent: "claude", model }`.
 *
 * Reports without a `model` (solution-verify runs) are grouped under a
 * dedicated sentinel so they do not pollute solver groups.
 */
export function getGroupKey(report: ChallengeReport): GroupKey {
  if (!report.model) {
    return {
      agent: "solution",
      model: "verify",
      contextProfile: report.contextProfile || "unknown",
    };
  }
  const primary = report.model.split("+")[0] ?? report.model;
  const { agent, model } = parseSolveModelLabel(primary);
  return {
    agent,
    model: model ?? "default",
    contextProfile: report.contextProfile || "unknown",
  };
}

export function formatGroupKey(key: GroupKey): string {
  return `${key.agent}:${key.model} / ${key.contextProfile}`;
}

export function groupKeyId(key: GroupKey): string {
  return `${key.agent}|${key.model}|${key.contextProfile}`;
}
