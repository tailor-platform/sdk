import path from "node:path";
import {
  installWorkspaceDepsOnHost,
  preflightClaudeOnHost,
  runClaudeOnHost,
} from "./claude-host-runner";
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
import type { SolverAgent, SolverRuntimeKind } from "./types";

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
  kind: SolverRuntimeKind;
  verifier: SolverRuntimeKind;
  image: string;
  agentPackage: string;
  /** Runs before each solver, outside any sandbox the solver itself runs in. */
  prepareWorkspace?: (options: {
    worktreePath: string;
    sharedPnpmStorePath?: string;
  }) => Promise<void>;
  preflight: (model: string) => Promise<SolverPreflight>;
  run: (options: SolverRunOptions) => Promise<SolverResult>;
};

export async function createSolverRuntime(
  agent: SolverAgent,
  packageRoot: string,
  kind: SolverRuntimeKind = "podman",
): Promise<SolverRuntime> {
  if (agent === "codex") {
    const runtime = getCodexRuntimeConfig();
    return {
      agent,
      kind: "podman",
      verifier: "podman",
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
  if (kind === "host") {
    return {
      agent,
      kind,
      verifier: "host",
      image: "host",
      agentPackage: runtime.claudePackage,
      prepareWorkspace: installWorkspaceDepsOnHost,
      preflight: async (model) => {
        const result = await preflightClaudeOnHost({ runtime, model });
        return { ...result, agentVersion: result.claudeVersion };
      },
      run: (options) =>
        runClaudeOnHost({ ...options, repoRoot: path.resolve(packageRoot, ".."), runtime }),
    };
  }
  const token = await resolveClaudeOAuthToken({ env: process.env, tokenFile: runtime.tokenFile });
  return {
    agent,
    kind,
    verifier: "podman",
    image: runtime.image,
    agentPackage: runtime.claudePackage,
    preflight: async (model) => {
      const result = await preflightClaudeRunner({ runtime, token, model });
      return { ...result, agentVersion: result.claudeVersion };
    },
    run: (options) => runClaudeInPodman({ ...options, runtime, token }),
  };
}
