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

interface RunSkillsInstallerOptions {
  additionalArgs?: string[];
  source?: string;
  spawnFn?: SpawnLike;
}

function resolveNpxCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "npx.cmd" : "npx";
}

function resolveSkillsSource(source?: string): string {
  const envSource = process.env[SKILLS_SOURCE_ENV_KEY];
  if (envSource) return envSource;
  if (source) return source;
  throw new Error(
    "Skill source is not resolved. Set TAILOR_SDK_SKILLS_SOURCE or pass `source` explicitly.",
  );
}

/**
 * Build CLI arguments for `skills add` with the fixed tailor-sdk skill target.
 * `--copy` is included so the installed skill survives `pnpm install` wiping `node_modules`.
 * @param additionalArgs - Additional options to pass through to `skills add`
 * @param source - Optional skill source URL or path
 * @returns CLI arguments for `npx skills add`
 */
export function buildSkillsAddArgs(additionalArgs: readonly string[], source?: string): string[] {
  return [
    "skills",
    "add",
    resolveSkillsSource(source),
    "--skill",
    SKILL_NAME,
    "--copy",
    ...additionalArgs,
  ];
}

/**
 * Run `npx skills add` to install the tailor-sdk skill.
 * @param options - Runtime options for skill installation
 * @returns Process exit code from the spawned `npx` command
 */
export async function runSkillsInstaller(options: RunSkillsInstallerOptions = {}): Promise<number> {
  const args = buildSkillsAddArgs(options.additionalArgs ?? [], options.source);
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
