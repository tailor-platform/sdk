export type SolveRawTranscript = {
  prompt: string;
  stdout: string;
  stderr: string;
};

export type SolveArtifact = {
  directory: string;
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
  resultPath: string;
  workSnapshotDir: string;
};

/**
 * Per-solve token usage. Surfaces the volume the agent read (input + cache reads)
 * vs wrote (output) so analytics can detect "context bloat" affordances. All
 * fields are optional so historic reports remain readable.
 */
export type SolveUsage = {
  inputTokens?: number;
  outputTokens?: number;
  /**
   * Tokens served from the model's prompt cache. High values indicate the
   * agent re-reads the same context across turns; relevant for context-bloat
   * diagnosis.
   */
  cacheReadTokens?: number;
  /** Number of agent turns (rough proxy for tool-call count). */
  numTurns?: number;
};

export type SolveResult = {
  success: boolean;
  durationMs: number;
  output: string;
  error?: string;
  infraFailure?: boolean;
  artifact?: SolveArtifact;
  rawTranscript?: SolveRawTranscript;
  usage?: SolveUsage;
};

export type SolveAgent = "codex";

/**
 * Reasoning effort levels accepted by `codex exec -c model_reasoning_effort=…`.
 * Only `gpt-5` family models accept `xhigh`; the harness currently hardcodes
 * `gpt-5.5`, which does, so all five values are valid.
 */
export const codexEffortValues = ["minimal", "low", "medium", "high", "xhigh"] as const;
export type CodexEffort = (typeof codexEffortValues)[number];

export function isCodexEffort(value: string): value is CodexEffort {
  return (codexEffortValues as readonly string[]).includes(value);
}

export type SolveRunOptions = {
  prompt: string;
  workDir: string;
  /** Reasoning effort forwarded to codex via `-c model_reasoning_effort=<effort>`. */
  effort: CodexEffort;
  /**
   * Optional path where the adapter should append a JSONL behaviour trace
   * (one `TraceEvent` per line; see `core/trace.ts`).
   */
  tracePath?: string;
  /**
   * Per-problem wall-clock cap in seconds. The adapter must terminate the
   * underlying agent process if it has not finished by this deadline.
   * Defaults to 3600 (1 hour) when unset — see `--max-seconds` in `cli.ts`.
   */
  maxSeconds?: number;
};

export type AuthCheckResult = {
  ok: boolean;
  error?: string;
};

export type SolveAdapter = {
  run: (options: SolveRunOptions) => Promise<SolveResult>;
  checkAuth: () => Promise<AuthCheckResult>;
};
