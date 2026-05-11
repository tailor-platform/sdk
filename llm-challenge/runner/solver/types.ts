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

export type SolveResult = {
  success: boolean;
  costUsd: number;
  durationMs: number;
  output: string;
  error?: string;
  infraFailure?: boolean;
  artifact?: SolveArtifact;
  rawTranscript?: SolveRawTranscript;
};

export type SolveAgent = "claude" | "codex";

export type SolveRunOptions = {
  prompt: string;
  workDir: string;
  model?: string;
  maxBudget: number;
};

export type AuthCheckResult = {
  ok: boolean;
  error?: string;
};

export type SolveAdapter = {
  run: (options: SolveRunOptions) => Promise<SolveResult>;
  checkAuth: (model?: string) => Promise<AuthCheckResult>;
};
