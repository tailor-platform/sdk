import { promises as fs } from "node:fs";
import path from "node:path";
import { runCommand } from "./process";
import { buildRunArtifactPaths, type RunArtifactPaths } from "./report";
import type { Problem, SdkProfile } from "./types";

const WORKSPACE_SDK_TARBALL = ".challenge/tailor-platform-sdk.tgz";
const WORKSPACE_PNPM_STORE = ".pnpm-store";
const PNPM_WORKSPACE_YAML = `allowBuilds:
  "@prisma/engines": true
  "@swc/core": true
  "@tailor-platform/sdk": true
  esbuild: true
  protobufjs: true
`;
const NPMRC_SETTINGS = new Map([
  ["store-dir", WORKSPACE_PNPM_STORE],
  ["prefer-offline", "true"],
  ["fetch-retries", "3"],
  ["fetch-retry-mintimeout", "10000"],
  ["fetch-retry-maxtimeout", "60000"],
]);
const GITIGNORE_PATTERNS = [
  ".challenge/",
  "node_modules/",
  ".pnpm-store/",
  ".pnpm-home/",
  ".cache/",
  ".tailor-sdk/cache/",
];

export async function prepareWorkspace(options: {
  outputDir: string;
  problem: Problem;
  runIndex: number;
  sdkTarballPath: string;
}): Promise<RunArtifactPaths> {
  const paths = buildRunArtifactPaths(options.outputDir, options.problem, options.runIndex);
  await fs.rm(paths.artifactDir, { recursive: true, force: true });
  await fs.mkdir(paths.worktreePath, { recursive: true });
  await copyScaffold(options.problem.scaffoldPath, paths.worktreePath);

  const prompt = await fs.readFile(options.problem.promptPath, "utf8");
  await fs.writeFile(paths.promptPath, prompt);

  const sdkTarballDest = path.join(paths.worktreePath, WORKSPACE_SDK_TARBALL);
  await fs.mkdir(path.dirname(sdkTarballDest), { recursive: true });
  await fs.copyFile(options.sdkTarballPath, sdkTarballDest);
  await ensureWorkspacePackage(paths.worktreePath);
  await ensurePnpmWorkspace(paths.worktreePath);
  await ensureNpmrc(paths.worktreePath);
  await fs.mkdir(path.join(paths.worktreePath, WORKSPACE_PNPM_STORE), { recursive: true });
  await ensureTsconfig(paths.worktreePath);
  await ensureGitignore(paths.worktreePath);
  await initializeWorkspaceGit(paths.worktreePath);
  return paths;
}

export function profileForProblem(
  problem: Pick<Problem, "group">,
  requestedProfile: SdkProfile,
): SdkProfile | null {
  return problem.group === "sdk-api" ? requestedProfile : null;
}

export async function pruneWorkspaceDeps(worktreePath: string): Promise<void> {
  await Promise.all(
    ["node_modules", ".pnpm-store", ".pnpm-home", ".cache", ".turbo", ".tailor-sdk/cache"].map(
      (name) => fs.rm(path.join(worktreePath, name), { recursive: true, force: true }),
    ),
  );
}

async function copyScaffold(scaffoldPath: string, worktreePath: string): Promise<void> {
  const entries = await fs.readdir(scaffoldPath, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      await fs.cp(path.join(scaffoldPath, entry.name), path.join(worktreePath, entry.name), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
    }),
  );
}

async function ensureWorkspacePackage(worktreePath: string): Promise<void> {
  const packageJsonPath = path.join(worktreePath, "package.json");
  const packageJson = await readJsonObject(packageJsonPath);
  packageJson.private ??= true;
  packageJson.type ??= "module";
  packageJson.packageManager ??= "pnpm@11.1.2";
  packageJson.dependencies = {
    ...(isObject(packageJson.dependencies) ? packageJson.dependencies : {}),
    "@tailor-platform/sdk": `file:${WORKSPACE_SDK_TARBALL}`,
  };
  packageJson.devDependencies = {
    ...(isObject(packageJson.devDependencies) ? packageJson.devDependencies : {}),
    "@types/node": "24.12.4",
    typescript: "5.9.3",
  };
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function ensureTsconfig(worktreePath: string): Promise<void> {
  const tsconfigPath = path.join(worktreePath, "tsconfig.json");
  try {
    await fs.access(tsconfigPath);
  } catch {
    await fs.writeFile(
      tsconfigPath,
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
          },
          include: ["**/*.ts"],
        },
        null,
        2,
      )}\n`,
    );
  }
}

async function ensurePnpmWorkspace(worktreePath: string): Promise<void> {
  await fs.writeFile(path.join(worktreePath, "pnpm-workspace.yaml"), PNPM_WORKSPACE_YAML);
}

async function ensureNpmrc(worktreePath: string): Promise<void> {
  const npmrcPath = path.join(worktreePath, ".npmrc");
  let current = "";
  try {
    current = await fs.readFile(npmrcPath, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const seen = new Set<string>();
  const lines = current
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const key = npmrcKey(line);
      if (key === undefined || !NPMRC_SETTINGS.has(key)) {
        return [line];
      }
      if (seen.has(key)) {
        return [];
      }
      seen.add(key);
      return [`${key}=${NPMRC_SETTINGS.get(key)}`];
    });

  for (const [key, value] of NPMRC_SETTINGS) {
    if (!seen.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  await fs.writeFile(npmrcPath, `${lines.join("\n")}\n`);
}

async function ensureGitignore(worktreePath: string): Promise<void> {
  const gitignorePath = path.join(worktreePath, ".gitignore");
  let current = "";
  try {
    current = await fs.readFile(gitignorePath, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  const lines = new Set(current.split(/\r?\n/).filter(Boolean));
  const additions = GITIGNORE_PATTERNS.filter((pattern) => !lines.has(pattern));
  if (additions.length === 0) {
    return;
  }
  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  await fs.writeFile(gitignorePath, `${current}${prefix}${additions.join("\n")}\n`);
}

function npmrcKey(line: string): string | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith(";")) {
    return undefined;
  }
  const equalsIndex = trimmed.indexOf("=");
  return equalsIndex === -1 ? undefined : trimmed.slice(0, equalsIndex).trim();
}

async function initializeWorkspaceGit(worktreePath: string): Promise<void> {
  await runCommand("git", ["init"], { cwd: worktreePath });
  await runCommand("git", ["config", "user.name", "llm-challenge"], { cwd: worktreePath });
  await runCommand("git", ["config", "user.email", "llm-challenge@example.invalid"], {
    cwd: worktreePath,
  });
  await runCommand("git", ["config", "commit.gpgSign", "false"], { cwd: worktreePath });
  await runCommand("git", ["add", "."], { cwd: worktreePath });
  const status = await runCommand("git", ["status", "--short"], { cwd: worktreePath });
  if (status.stdout.trim().length === 0) {
    return;
  }
  await runCommand("git", ["commit", "-m", "chore: initialize challenge workspace"], {
    cwd: worktreePath,
  });
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    return isObject(parsed) ? parsed : {};
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
