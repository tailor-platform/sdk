import {
  getClaudeRuntimeConfig,
  preflightClaudeRunner,
  resolveClaudeOAuthToken,
  runClaudeInPodman,
} from "./claude-runner";
import {
  getCodexRuntimeConfig,
  preflightCodexRunner,
  runCodexInPodman,
  type SolverResult,
} from "./runner";
import type { SolverAgent } from "./types";

export type SolverPreflight = {
  skipped: boolean;
  exitCode?: number;
  durationMs?: number;
  stderr?: string;
  agentVersion?: string;
};

export type SolverRunOptions = {
  containerName: string;
  worktreePath: string;
  promptPath: string;
  solverStdoutPath: string;
  solverStderrPath: string;
  tracePath: string;
  model: string;
  effort: string;
  maxSeconds: number;
  sharedPnpmStorePath?: string;
};

export type SolverRuntime = {
  agent: SolverAgent;
  image: string;
  agentPackage: string;
  preflight: (model: string) => Promise<SolverPreflight>;
  run: (options: SolverRunOptions) => Promise<SolverResult>;
};

export async function createSolverRuntime(
  agent: SolverAgent,
  packageRoot: string,
): Promise<SolverRuntime> {
  if (agent === "codex") {
    const runtime = getCodexRuntimeConfig();
    return {
      agent,
      image: runtime.image,
      agentPackage: runtime.codexPackage,
      preflight: async () => {
        const result = await preflightCodexRunner(runtime);
        return { ...result, agentVersion: result.codexVersion };
      },
      run: (options) => runCodexInPodman({ ...options, runtime }),
    };
  }

  const runtime = getClaudeRuntimeConfig(packageRoot);
  const token = await resolveClaudeOAuthToken({ env: process.env, tokenFile: runtime.tokenFile });
  return {
    agent,
    image: runtime.image,
    agentPackage: runtime.claudePackage,
    preflight: async (model) => {
      const result = await preflightClaudeRunner({ runtime, token, model });
      return { ...result, agentVersion: result.claudeVersion };
    },
    run: (options) => runClaudeInPodman({ ...options, runtime, token }),
  };
}
