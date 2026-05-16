/** Default Ollama model id when no `--model` is supplied. */
const DEFAULT_OSS_MODEL = "qwen2.5-coder:7b";

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
 * Parse a `"oss:<model>"` label written by `formatSolveModelLabel`. Returns
 * the model id (without the `oss:` prefix); labels that don't carry the
 * prefix are returned verbatim, and `undefined` falls back to the default.
 */
export function parseSolveModelLabel(label?: string): { model: string } {
  if (!label) {
    return { model: DEFAULT_OSS_MODEL };
  }
  if (label.startsWith("oss:")) {
    return { model: label.slice("oss:".length) };
  }
  return { model: label };
}
