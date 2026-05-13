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
   * Tokens read from the Anthropic prompt cache. High values indicate the
   * agent re-reads the same context across turns; relevant for context-bloat
   * diagnosis.
   */
  cacheReadTokens?: number;
  /** Number of agent turns (rough proxy for tool-call count when stream-json is unavailable). */
  numTurns?: number;
};

export type SolveResult = {
  success: boolean;
  costUsd: number;
  durationMs: number;
  output: string;
  error?: string;
  infraFailure?: boolean;
  artifact?: SolveArtifact;
  rawTranscript?: SolveRawTranscript;
  usage?: SolveUsage;
};

export type SolveAgent = "claude" | "codex";

export type SolveRunOptions = {
  prompt: string;
  workDir: string;
  model?: string;
  maxBudget: number;
  /**
   * Optional path where the adapter should append a JSONL behaviour trace
   * (one `TraceEvent` per line; see `core/trace.ts`). Adapters that cannot
   * emit a structured stream (or whose output format change would break
   * compatibility) should silently ignore this option.
   */
  tracePath?: string;
};

export type AuthCheckResult = {
  ok: boolean;
  error?: string;
};

export type SolveAdapter = {
  run: (options: SolveRunOptions) => Promise<SolveResult>;
  checkAuth: (model?: string) => Promise<AuthCheckResult>;
};
