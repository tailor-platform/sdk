export const PROBLEM_GROUPS = ["sdk-api", "cli"] as const;
export const SDK_PROFILES = ["no-docs", "full"] as const;
export const SOLVER_AGENTS = ["claude", "codex"] as const;

export type ProblemGroup = (typeof PROBLEM_GROUPS)[number];
export type SdkProfile = (typeof SDK_PROFILES)[number];
export type SolverAgent = (typeof SOLVER_AGENTS)[number];
export type RequestedGroup = ProblemGroup | "all";

export type Problem = {
  id: string;
  title: string;
  group: ProblemGroup;
  sourcePath: string;
  promptPath: string;
  scaffoldPath: string;
  verifyPath?: string;
  rubricPath?: string;
};

export type RunOptions = {
  agent: SolverAgent;
  agentExplicit: boolean;
  sdkRef: string;
  profile: SdkProfile;
  profileExplicit: boolean;
  group: RequestedGroup;
  model: string;
  modelExplicit: boolean;
  effort: string;
  effortExplicit: boolean;
  runs: number;
  concurrency: number;
  problemFilters: string[];
  output?: string;
  maxSeconds: number;
  preflight: boolean;
  pruneWorkspaceDeps: boolean;
  rerunNonzeroFrom?: string;
};

export type ChallengeReport = {
  schemaVersion: 2;
  runId: string;
  timestamp: string;
  agent: SolverAgent;
  sdkRef: string;
  sdkVersion?: string;
  requestedProfile: SdkProfile;
  model: string;
  effort: string;
  runsPerProblem: number;
  runner?: {
    image: string;
    agentPackage: string;
    agentVersion?: string;
    preflight: {
      skipped: boolean;
      exitCode?: number;
      durationMs?: number;
      stderr?: string;
    };
  };
  rerunOf?: {
    sourceReportPath: string;
    sourceRunId?: string;
    runs: Array<{
      problemId: string;
      group: ProblemGroup;
      runIndex: number;
      artifactDir?: string;
      solverExitCode?: number;
      timedOut?: boolean;
    }>;
  };
  problems: Array<{
    id: string;
    title: string;
    group: ProblemGroup;
    sourcePath: string;
  }>;
  runs: ChallengeRunReport[];
};

/** Reports written before the Claude solver have schemaVersion 1 and no `agent` (Codex only). */
export type StoredChallengeReport = Omit<ChallengeReport, "schemaVersion" | "agent"> & {
  schemaVersion: 1 | 2;
  agent?: SolverAgent;
};

export type ChallengeRunReport = {
  problemId: string;
  group: ProblemGroup;
  profile: SdkProfile | null;
  runIndex: number;
  artifactDir: string;
  promptPath: string;
  solverStdoutPath: string;
  solverStderrPath: string;
  tracePath: string;
  worktreePath: string;
  artifactSummaryPath?: string;
  verificationSummaryPath?: string;
  verificationStdoutPath?: string;
  verificationStderrPath?: string;
  solverExitCode?: number;
  durationMs?: number;
  timedOut?: boolean;
  failureKind?: SolverFailureKind;
  agentResult?: AgentResultSummary;
  replaces?: {
    sourceReportPath: string;
    sourceRunId?: string;
    artifactDir?: string;
    solverExitCode?: number;
    timedOut?: boolean;
  };
};

export type SolverFailureKind =
  | "none"
  | "timeout"
  | "usage-limit"
  | "auth"
  | "model-mismatch"
  | "runner-startup"
  | "solver-nonzero"
  | "unknown";

export type AgentResultSummary = {
  toolCalls: number;
  servedModels: string[];
  subtype?: string;
  isError?: boolean;
  numTurns?: number;
  durationMs?: number;
  totalCostUsd?: number;
  apiErrorStatus?: number | null;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
};
