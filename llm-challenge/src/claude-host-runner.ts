import { promises as fs } from "node:fs";
import path from "node:path";
import {
  assertClaudeInstalled,
  buildClaudeSolverArgs,
  type ClaudeRuntimeConfig,
} from "./claude-runner";
import { runAgentProcess, type SolverResult } from "./runner";

const HOST_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
];
const HOST_ALLOWED_DOMAINS = ["registry.npmjs.org"];
const HOST_HIDDEN_HOME_PATHS = [
  "~/.ssh",
  "~/.aws",
  "~/.config",
  "~/.claude",
  "~/.claude.json",
  "~/.codex",
  "~/.gnupg",
  "~/.kube",
  "~/.docker",
  "~/.npmrc",
  "~/.netrc",
  "~/.zsh_history",
  "~/.bash_history",
  "~/.zshrc",
  "~/.zshenv",
  "~/.zprofile",
  "~/.bashrc",
  "~/.profile",
  "~/.gitconfig",
  "~/.git-credentials",
  "~/Desktop",
  "~/Documents",
  "~/Downloads",
  "~/Library/Keychains",
  "~/Library/Application Support",
  "~/Library/Cookies",
  "~/Library/Mail",
  "~/Library/Messages",
  "~/Library/Safari",
];
const HOST_READABLE_HOME_PATHS = ["~/.config/mise"];

export type HostSettings = {
  permissions: { allow: string[] };
  sandbox: {
    enabled: true;
    autoAllowBashIfSandboxed: true;
    allowUnsandboxedCommands: false;
    failIfUnavailable: true;
    filesystem: { denyRead: string[]; allowRead: string[]; allowWrite: string[] };
    network: { allowedDomains: string[]; strictAllowlist: true };
  };
};

export function buildHostEnv(
  env: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const key of HOST_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) {
      filtered[key] = value;
    }
  }
  return { ...filtered, ...extra };
}

export function buildHostSettings(options: {
  repoRoot: string;
  worktreePath: string;
  sharedPnpmStorePath?: string;
}): HostSettings {
  const store = options.sharedPnpmStorePath === undefined ? [] : [options.sharedPnpmStorePath];
  return {
    permissions: {
      allow: ["Bash", `Read(/${options.worktreePath}/**)`, `Edit(/${options.worktreePath}/**)`],
    },
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
      filesystem: {
        denyRead: [options.repoRoot, ...HOST_HIDDEN_HOME_PATHS],
        allowRead: [options.worktreePath, ...store, ...HOST_READABLE_HOME_PATHS],
        allowWrite: store,
      },
      network: { allowedDomains: HOST_ALLOWED_DOMAINS, strictAllowlist: true },
    },
  };
}

export function buildClaudeHostArgs(options: {
  model: string;
  effort: string;
  settings: HostSettings;
}): string[] {
  return [
    ...buildClaudeSolverArgs({
      model: options.model,
      effort: options.effort,
      permissionMode: "default",
    }),
    "--safe-mode",
    "--settings",
    JSON.stringify(options.settings),
  ];
}

export async function runClaudeOnHost(options: {
  repoRoot: string;
  worktreePath: string;
  promptPath: string;
  solverStdoutPath: string;
  solverStderrPath: string;
  tracePath: string;
  model: string;
  effort: string;
  maxSeconds: number;
  sharedPnpmStorePath?: string;
  runtime: ClaudeRuntimeConfig;
}): Promise<SolverResult> {
  await assertClaudeInstalled(options.runtime);
  const worktreePath = await fs.realpath(options.worktreePath);
  const settings = buildHostSettings({
    repoRoot: await fs.realpath(options.repoRoot),
    worktreePath,
    sharedPnpmStorePath:
      options.sharedPnpmStorePath === undefined
        ? undefined
        : await fs.realpath(options.sharedPnpmStorePath),
  });
  await Promise.all([
    fs.writeFile(options.solverStdoutPath, ""),
    fs.writeFile(options.solverStderrPath, ""),
    fs.writeFile(options.tracePath, ""),
  ]);
  return await runAgentProcess({
    command: path.join(options.runtime.installCacheDir, "bin", "claude"),
    args: buildClaudeHostArgs({ model: options.model, effort: options.effort, settings }),
    prompt: await fs.readFile(options.promptPath, "utf8"),
    solverStdoutPath: options.solverStdoutPath,
    solverStderrPath: options.solverStderrPath,
    tracePath: options.tracePath,
    maxSeconds: options.maxSeconds,
    cwd: worktreePath,
    env: buildHostEnv(
      process.env,
      options.sharedPnpmStorePath === undefined
        ? {}
        : { PNPM_CONFIG_STORE_DIR: options.sharedPnpmStorePath },
    ),
    replaceEnv: true,
    killProcessGroup: true,
  });
}
