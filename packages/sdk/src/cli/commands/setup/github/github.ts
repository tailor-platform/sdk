import * as fs from "node:fs";
import * as path from "pathe";
import { logBetaWarning } from "@/cli/shared/beta";
import { logger, styles } from "@/cli/shared/logger";
import { detectPackageManager, renderDeploy } from "./templates";

export type SetupGitHubOptions = {
  workspaceName: string;
  workspaceRegion: string;
  organizationId: string;
  folderId: string;
  dir: string;
  outputDir: string;
  withPlan?: boolean;
};

type GeneratedFile = {
  path: string;
  content: string;
};

type WriteResult = {
  written: string[];
  skipped: string[];
};

/**
 * Build the list of GitHub Actions files to generate.
 * @param options - Setup options including workspace config and output directory
 * @returns Array of files with paths and rendered content
 */
export function buildFiles(options: SetupGitHubOptions): GeneratedFile[] {
  const githubDir = path.join(options.outputDir, ".github");
  const packageManager = detectPackageManager(options.outputDir);
  const workingDirectory = options.dir !== "." ? options.dir : undefined;

  return [
    {
      path: path.join(githubDir, `workflows/tailor-${options.workspaceName}.yml`),
      content: renderDeploy({
        workspaceName: options.workspaceName,
        workspaceRegion: options.workspaceRegion,
        organizationId: options.organizationId,
        folderId: options.folderId,
        workingDirectory,
        packageManager,
        withPlan: options.withPlan,
      }),
    },
  ];
}

/**
 * Write files to disk, skipping any that already exist.
 * @param files - Files to write
 * @returns Result with lists of written and skipped file paths
 */
export function writeFiles(files: GeneratedFile[]): WriteResult {
  const written: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (fs.existsSync(file.path)) {
      skipped.push(file.path);
      continue;
    }
    fs.mkdirSync(path.dirname(file.path), { recursive: true });
    fs.writeFileSync(file.path, file.content);
    written.push(file.path);
  }

  return { written, skipped };
}

/**
 * Generate GitHub Actions workflow files and print next steps.
 * @param options - Setup options including workspace config and output directory
 */
export function setupGitHub(options: SetupGitHubOptions): void {
  logBetaWarning("setup github");

  const files = buildFiles(options);
  const result = writeFiles(files);

  for (const filePath of result.written) {
    const relativePath = path.relative(options.outputDir, filePath);
    logger.success(`Generated ${styles.path(relativePath)}`);
  }

  for (const filePath of result.skipped) {
    const relativePath = path.relative(options.outputDir, filePath);
    logger.warn(`Skipped ${styles.path(relativePath)} (already exists)`);
  }

  logger.newline();
  logger.info("Next steps - set GitHub secrets:");
  logger.log(`  gh secret set PLATFORM_MACHINE_USER_CLIENT_ID`);
  logger.log(`  gh secret set PLATFORM_MACHINE_USER_CLIENT_SECRET`);

  if (options.withPlan) {
    logger.newline();
    logger.info("For plan job - set GitHub variable with your workspace ID:");
    logger.log(`  gh variable set TAILOR_PLATFORM_WORKSPACE_ID`);
  }
}
