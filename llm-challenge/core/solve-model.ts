import type { CodexEffort } from "./solver/types";

/**
 * The harness pins codex to a single model — `solve-model.ts` only encodes
 * the effort axis into a string label used as a results-directory key
 * (`codex-gpt-5.5-<effort>`). If we ever bind to a different model, update
 * this constant in lockstep with `core/solver/codex.ts`.
 */
const MODEL_TAG = "codex-gpt-5.5";

export function formatSolveModelLabel(effort: CodexEffort): string {
  return `${MODEL_TAG}-${effort}`;
}

/**
 * Parse a model label written by `formatSolveModelLabel`. Returns the
 * verbatim label as `model` (used as analyze.ts group key) and the
 * reasoning effort encoded in the suffix when recognisable. Labels from
 * older reports (`oss:<model>`, raw `<model-id>`, or anything that does
 * not match the current scheme) are returned as-is with `effort` unset so
 * historic reports keep grouping correctly.
 */
export function parseSolveModelLabel(label?: string): { model: string; effort?: string } {
  if (!label) return { model: "" };
  if (label.startsWith(`${MODEL_TAG}-`)) {
    return { model: label, effort: label.slice(MODEL_TAG.length + 1) };
  }
  return { model: label };
}
