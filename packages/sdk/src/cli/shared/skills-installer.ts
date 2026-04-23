import { spawn } from "node:child_process";

export const SKILL_NAME = "tailor-sdk";
const SKILLS_SOURCE_ENV_KEY = "TAILOR_SDK_SKILLS_SOURCE";

interface ChildProcessLike {
  on(event: "close", listener: (code: number | null) => void): ChildProcessLike;
  on(event: "error", listener: (error: Error) => void): ChildProcessLike;
}

type SpawnLike = (
  command: string,
  args: string[],
  options: { stdio: "inherit" },
) => ChildProcessLike;

export interface RunSkillsInstallerOptions {
  source: string;
  agent?: string;
  yes?: boolean;
  spawnFn?: SpawnLike;
}

function resolveNpxCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "npx.cmd" : "npx";
}

function resolveSkillsSource(source: string): string {
  return process.env[SKILLS_SOURCE_ENV_KEY] ?? source;
}

/**
 * Build CLI arguments for `skills add` with the fixed tailor-sdk skill target.
 * `--copy` is included so the installed skill survives `pnpm install` wiping `node_modules`.
 * @param options - Options controlling the generated `skills add` arguments
 * @param options.source
 * @param options.agent
 * @param options.yes
 * @returns CLI arguments for `npx skills add`
 */
export function buildSkillsAddArgs(options: {
  source: string;
  agent?: string;
  yes?: boolean;
}): string[] {
  const args = [
    "skills",
    "add",
    resolveSkillsSource(options.source),
    "--skill",
    SKILL_NAME,
    "--copy",
  ];
  if (options.agent) args.push("--agent", options.agent);
  if (options.yes) args.push("--yes");
  return args;
}

/**
 * Run `npx skills add` to install the tailor-sdk skill.
 * @param options - Runtime options for skill installation
 * @returns Process exit code from the spawned `npx` command
 */
export async function runSkillsInstaller(options: RunSkillsInstallerOptions): Promise<number> {
  const args = buildSkillsAddArgs({
    source: options.source,
    agent: options.agent,
    yes: options.yes,
  });
  const spawnFn =
    options.spawnFn ??
    ((command: string, spawnArgs: string[], spawnOptions: { stdio: "inherit" }) =>
      spawn(command, spawnArgs, spawnOptions));

  const childProcess = spawnFn(resolveNpxCommand(), args, { stdio: "inherit" });

  return await new Promise<number>((resolve, reject) => {
    childProcess.on("error", (error) => reject(error));
    childProcess.on("close", (code) => resolve(code ?? 1));
  });
}
