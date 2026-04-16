import * as fs from "node:fs";
import * as path from "pathe";
import { loadConfigPath } from "@/cli/shared/context";
import {
  detectBaseRef,
  gitTopLevel,
  prepareMergeWorktree,
  type PreparedMergeWorktree,
} from "@/cli/shared/git";
import { logger, styles } from "@/cli/shared/logger";
import { linkNodeModules } from "@/cli/shared/merge-worktree-deps";

/**
 * Options for translating the config path into the merged worktree.
 */
export interface TranslateConfigPathOptions {
  originalAbsPath: string;
  repoRoot: string;
  worktreeRoot: string;
}

/**
 * Translate an absolute config path from the source repository into the
 * equivalent path inside the merged worktree.
 * @param options - Original absolute config path, repository root, and worktree root
 * @returns Absolute path to the config file inside the worktree
 */
export function translateConfigPath(options: TranslateConfigPathOptions): string {
  const { originalAbsPath, repoRoot, worktreeRoot } = options;
  const rel = path.relative(repoRoot, originalAbsPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Config path ${originalAbsPath} is outside the repository root ${repoRoot} and cannot be translated.`,
    );
  }
  return path.join(worktreeRoot, rel);
}

/**
 * Options for preparing a merge-plan run.
 */
export interface PrepareBasePlanOptions {
  /** Optional explicit base ref. When omitted, auto-detected via gh / origin/HEAD. */
  baseRef?: string;
  /** Optional config path passed on the CLI. When omitted, discovered via loadConfigPath. */
  configPath?: string;
}

/**
 * Result of preparing a merge-plan run.
 */
export interface PreparedBasePlan {
  /** Absolute path to the config file inside the merged worktree. */
  configPath: string;
  /** The worktree handle (for cleanup via `dispose()`). */
  worktree: PreparedMergeWorktree;
  /** The ref used as the merge base. */
  baseRef: string;
}

/**
 * Prepare a merged worktree for a base plan run. Detects the base ref, creates
 * the worktree, links node_modules, and returns the translated config path.
 * On any failure before the worktree is returned, the worktree is disposed.
 * @param options - Base ref, config path, and cwd
 * @returns Prepared worktree, translated config path, and base ref
 */
export async function prepareBasePlan(
  options: PrepareBasePlanOptions = {},
): Promise<PreparedBasePlan> {
  const repoRoot = await gitTopLevel();

  let baseRef = options.baseRef;
  if (!baseRef) {
    const detected = await detectBaseRef({ cwd: repoRoot });
    if (!detected) {
      throw new Error(
        "Could not detect base ref automatically. Pass --base-ref <ref> explicitly (e.g. --base-ref origin/main).",
      );
    }
    baseRef = detected;
  }

  const originalAbsPath = resolveOriginalConfigPath(options.configPath);

  logger.info(`Planning against ${styles.info(baseRef)} merged with current HEAD`);

  const worktree = await prepareMergeWorktree({ repoRoot, baseRef });
  try {
    const linkResult = linkNodeModules({ sourceRoot: repoRoot, targetRoot: worktree.path });
    if (linkResult.method === "abort") {
      throw new Error(
        `Cannot prepare merge worktree: ${linkResult.reason ?? "unknown reason"} ` +
          `Aborting base plan to avoid stale or inconsistent dependencies.`,
      );
    }
    const configPath = translateConfigPath({
      originalAbsPath,
      repoRoot,
      worktreeRoot: worktree.path,
    });
    return { configPath, worktree, baseRef };
  } catch (err) {
    await worktree.dispose();
    throw err;
  }
}

function resolveOriginalConfigPath(configPath?: string): string {
  const found = loadConfigPath(configPath);
  if (!found) {
    throw new Error(
      "tailor.config.ts not found in the current or parent directories. Specify --config to use --base.",
    );
  }
  const resolved = path.resolve(process.cwd(), found);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Configuration file not found: ${resolved}`);
  }
  return resolved;
}
