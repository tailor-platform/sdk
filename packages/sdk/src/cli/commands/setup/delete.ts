import * as fs from "node:fs";
import * as path from "pathe";
import { logBetaWarning } from "#/cli/shared/beta";
import { logger, styles } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { resolveWithinRoot } from "./check";
import { LOCK_VERSION, readLock, writeLock, type LockTarget, type SetupRegistration } from "./lock";

export type DeleteOptions = {
  /** Repo-relative paths to files registered by a setup subcommand. */
  files: string[];
  /** Skip the confirmation prompt. */
  yes: boolean;
  outputDir: string;
};

// Mirrors the --dir normalization in generate.ts's resolve(): POSIX separators,
// collapsed duplicate slashes, no leading "./" or trailing "/", so a path typed
// with either style still matches the posix-normalized `file` recorded in the lock.
function normalizeRelPath(input: string): string {
  return input
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
}

type TargetMatch = { type: "target"; relPath: string; absPath: string; target: LockTarget };
type SetupMatch = {
  type: "setup";
  relPath: string;
  absPath: string;
  setup: SetupRegistration;
};
type Match = TargetMatch | SetupMatch;

function targetKey(target: LockTarget): string {
  return `${target.kind}:${target.workspaceName}`;
}

function resolveMatch(
  outputDir: string,
  targets: readonly LockTarget[],
  setups: readonly SetupRegistration[],
  input: string,
): Match {
  const relPath = normalizeRelPath(input);
  const absPath = resolveWithinRoot(outputDir, relPath);
  if (absPath === null) {
    throw new Error(`"${input}" must be a path inside the repository.`);
  }
  const target = targets.find((t) => t.file === relPath);
  if (target) return { type: "target", relPath, absPath, target };
  const setup = setups.find((entry) => entry.file === relPath);
  if (setup) return { type: "setup", relPath, absPath, setup };
  throw new Error(
    `"${relPath}" is not recorded in .github/tailor.lock. ` +
      "Only files registered by `tailor setup` can be deleted with this command.",
  );
}

// Skips the warning when the referencing coordinator is also part of this
// delete call, regardless of the order the files were passed in.
function warnCoordinatorReferences(
  allTargets: readonly LockTarget[],
  deletedKeys: ReadonlySet<string>,
  match: TargetMatch,
): void {
  if (match.target.kind !== "action") return;
  for (const coordinator of allTargets) {
    if (
      coordinator.kind === "coordinate" &&
      coordinator.inputs.actionDirs?.includes(match.target.inputs.dir) &&
      !deletedKeys.has(targetKey(coordinator))
    ) {
      logger.warn(
        `Coordinator "${coordinator.workspaceName}" still references this action's directory ` +
          `(${match.target.inputs.dir}). Remove \`${match.target.workspaceName}\` from the ` +
          `relevant \`--action\` value and re-run \`tailor setup coordinate\` to update it.`,
      );
    }
  }
}

/**
 * Delete setup-registered files and their `.github/tailor.lock` entries.
 *
 * Refuses to touch files that are not recorded in the lock. A registered
 * Renovate config may contain user customizations, so deletion calls this out
 * in the confirmation prompt.
 * @param options - Delete options
 */
export async function setupDelete(options: DeleteOptions): Promise<void> {
  logBetaWarning("setup");

  const { outputDir, yes } = options;
  const lock = readLock(outputDir);
  if (!lock || (lock.targets.length === 0 && lock.setups.length === 0)) {
    throw new Error(
      "No setup files found (.github/tailor.lock is missing or empty). " +
        "Run `tailor setup branch` (or another setup subcommand) first.",
    );
  }

  const relPaths = [...new Set(options.files.map(normalizeRelPath))];
  const matches = relPaths.map((relPath) =>
    resolveMatch(outputDir, lock.targets, lock.setups, relPath),
  );

  const deletedKeys = new Set(
    matches
      .filter((match): match is TargetMatch => match.type === "target")
      .map((match) => targetKey(match.target)),
  );
  for (const match of matches) {
    if (match.type === "target") {
      warnCoordinatorReferences(lock.targets, deletedKeys, match);
    }
  }

  if (!yes) {
    const list = matches.map((m) => m.relPath).join("\n  ");
    const renovateWarning = matches.some((match) => match.type === "setup")
      ? "\nAny Renovate customizations in that file will also be deleted."
      : "";
    const confirmed = await prompt.confirm({
      message:
        `This will delete the following file(s) and their .github/tailor.lock entries:\n  ${list}\n` +
        `${renovateWarning}\nContinue?`,
      default: false,
    });
    if (!confirmed) {
      logger.info("Delete cancelled.");
      return;
    }
  }

  const remainingTargets = [...lock.targets];
  const remainingSetups = [...lock.setups];
  try {
    for (const match of matches) {
      fs.rmSync(match.absPath, { force: true });
      if (match.type === "target" && match.target.kind === "action") {
        const dir = path.dirname(match.absPath);
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      }
      if (match.type === "target") {
        const index = remainingTargets.findIndex(
          (target) => targetKey(target) === targetKey(match.target),
        );
        if (index !== -1) remainingTargets.splice(index, 1);
        logger.success(
          `Deleted ${styles.path(match.relPath)} (${match.target.kind} ${match.target.workspaceName})`,
        );
      } else {
        const index = remainingSetups.findIndex((setup) => setup.file === match.setup.file);
        if (index !== -1) remainingSetups.splice(index, 1);
        logger.success(`Deleted ${styles.path(match.relPath)} (${match.setup.kind} setup)`);
      }
    }
  } finally {
    if (
      remainingTargets.length !== lock.targets.length ||
      remainingSetups.length !== lock.setups.length
    ) {
      writeLock(outputDir, {
        version: LOCK_VERSION,
        targets: remainingTargets,
        setups: remainingSetups,
      });
    }
  }
}
