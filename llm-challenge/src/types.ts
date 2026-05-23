export const PROBLEM_GROUPS = ["sdk-api", "cli"] as const;
export const SDK_PROFILES = ["no-docs", "full"] as const;

export type ProblemGroup = (typeof PROBLEM_GROUPS)[number];
export type SdkProfile = (typeof SDK_PROFILES)[number];
export type RequestedGroup = ProblemGroup | "all";

export type Problem = {
  id: string;
  title: string;
  group: ProblemGroup;
  sourcePath: string;
  absolutePath: string;
  promptPath: string;
  scaffoldPath: string;
};

export type RunOptions = {
  sdkRef: string;
  profile: SdkProfile;
  profileExplicit: boolean;
  group: RequestedGroup;
  model: string;
  effort: string;
  runs: number;
  concurrency: number;
  problemFilters: string[];
  output?: string;
  maxSeconds: number;
};

export type ChallengeReport = {
  schemaVersion: 1;
  runId: string;
  timestamp: string;
  sdkRef: string;
  sdkVersion?: string;
  requestedProfile: SdkProfile;
  model: string;
  effort: string;
  runsPerProblem: number;
  problems: Array<{
    id: string;
    title: string;
    group: ProblemGroup;
    sourcePath: string;
  }>;
  runs: ChallengeRunReport[];
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
  solverExitCode?: number;
  durationMs?: number;
  timedOut?: boolean;
};
