import { promises as fs } from "node:fs";
import path from "node:path";
import { buildRunArtifactPaths, type RunArtifactPaths } from "./report";
import type { Problem, SdkProfile } from "./types";

const WORKSPACE_SDK_TARBALL = ".challenge/tailor-platform-sdk.tgz";
const PNPM_WORKSPACE_YAML = `allowBuilds:
  "@prisma/engines": true
  "@swc/core": true
  "@tailor-platform/sdk": true
  esbuild: true
  protobufjs: true
`;

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
  await ensureTsconfig(paths.worktreePath);
  return paths;
}

export function profileForProblem(
  problem: Pick<Problem, "group">,
  requestedProfile: SdkProfile,
): SdkProfile | null {
  return problem.group === "sdk-api" ? requestedProfile : null;
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
            module: "NodeNext",
            moduleResolution: "NodeNext",
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
