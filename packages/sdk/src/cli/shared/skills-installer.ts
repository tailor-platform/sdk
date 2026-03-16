import * as fs from "node:fs";
import * as path from "pathe";
import { logger, styles } from "./logger";

export const SKILL_NAME = "tailor-sdk";
const SKILLS_DEST_DIR = ".claude/skills/tailor-sdk";
const ARTIFACTS_DIR = "_artifacts";
const SDK_PACKAGE_NAME = "@tailor-platform/sdk";

export interface CopySkillsOptions {
  projectDir?: string;
  sourceDir?: string;
}

export interface CopySkillsResult {
  copiedFiles: string[];
  destinationDir: string;
}

/**
 * Find the SDK package root by walking up from the current file's directory,
 * looking for a package.json with the SDK package name.
 * Works regardless of bundler inlining depth (src/cli/shared/, dist/cli/, etc.).
 * @returns Absolute path to the skills/ directory within the SDK package.
 */
export function resolveSkillsSourceDir(): string {
  const startDir = path.dirname(
    typeof import.meta.filename === "string"
      ? import.meta.filename
      : new URL(import.meta.url).pathname,
  );

  let dir = startDir;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const pkgJsonPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { name?: string };
        if (pkg.name === SDK_PACKAGE_NAME) {
          const skillsDir = path.join(dir, "skills");
          if (fs.existsSync(skillsDir)) {
            return skillsDir;
          }
        }
      } catch {
        // Ignore malformed package.json, keep searching
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw new Error("Failed to resolve `@tailor-platform/sdk`. Ensure the package is installed.");
}

function collectFiles(dir: string, baseDir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name === ARTIFACTS_DIR) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, baseDir));
    } else {
      results.push(path.relative(baseDir, fullPath));
    }
  }
  return results;
}

/**
 * Copy skill files from the SDK package to the project's .claude/skills directory.
 * @param options - Options for controlling the copy behavior.
 * @returns Result object describing what was copied.
 */
export function copySkills(options: CopySkillsOptions = {}): CopySkillsResult {
  const { projectDir = process.cwd() } = options;

  const sourceDir = options.sourceDir ?? resolveSkillsSourceDir();
  const destDir = path.join(projectDir, SKILLS_DEST_DIR);

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Skills directory not found at ${sourceDir}`);
  }

  const relativeFiles = collectFiles(sourceDir, sourceDir);
  const copiedFiles: string[] = [];

  for (const relFile of relativeFiles) {
    const srcFile = path.join(sourceDir, relFile);
    const destFile = path.join(destDir, relFile);

    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.copyFileSync(srcFile, destFile);
    copiedFiles.push(relFile);
  }

  return { copiedFiles, destinationDir: destDir };
}

interface RunSkillsInstallerOptions {
  sourceDir?: string;
  projectDir?: string;
}

/**
 * Run the skills installer to copy skill files into the project.
 * @param options - Runtime options for skill installation.
 * @param options.sourceDir - Override the skills source directory.
 * @param options.projectDir - Override the target project directory.
 * @returns Process exit code (0 for success, 1 for failure).
 */
export async function runSkillsInstaller(options: RunSkillsInstallerOptions = {}): Promise<number> {
  try {
    const result = copySkills({
      projectDir: options.projectDir,
      sourceDir: options.sourceDir,
    });

    if (result.copiedFiles.length === 0) {
      logger.info("No skill files to copy.");
    } else {
      logger.success(
        `Copied ${result.copiedFiles.length} skill file(s) to ${styles.dim(result.destinationDir)}`,
      );
      for (const file of result.copiedFiles) {
        logger.info(styles.dim(file), { mode: "plain" });
      }
    }

    return 0;
  } catch (error) {
    logger.error(
      `Failed to install skills: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}
