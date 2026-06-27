import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import * as path from "pathe";

export interface RunnerMetadata {
  packageName: string;
  packageVersion: string;
  gitCommit?: string;
  localBuildCommand?: string;
}

interface CreateRunnerMetadataOptions {
  packageName: string;
  packageVersion: string;
  packageRoot: string;
  readGit?: (cwd: string, args: string[]) => string | undefined;
  realpath?: (value: string) => string;
}

const SOURCE_PACKAGE_PATH = "packages/sdk-codemod";
const LOCAL_BUILD_COMMAND = "pnpm --dir packages/sdk-codemod build";

export function createRunnerMetadata({
  packageName,
  packageVersion,
  packageRoot,
  readGit = readGitOutput,
  realpath = safeRealpath,
}: CreateRunnerMetadataOptions): RunnerMetadata {
  const metadata: RunnerMetadata = { packageName, packageVersion };
  const gitRoot = readGit(packageRoot, ["rev-parse", "--show-toplevel"]);
  if (!gitRoot) return metadata;

  const packagePathFromRoot = path
    .normalize(path.relative(realpath(gitRoot), realpath(packageRoot)))
    .replaceAll("\\", "/");

  if (packagePathFromRoot !== SOURCE_PACKAGE_PATH) return metadata;

  const gitCommit = readGit(packageRoot, ["rev-parse", "--verify", "HEAD"]);
  if (!gitCommit) return metadata;

  return {
    ...metadata,
    gitCommit,
    localBuildCommand: LOCAL_BUILD_COMMAND,
  };
}

function readGitOutput(cwd: string, args: string[]): string | undefined {
  try {
    const output = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}

function safeRealpath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}
