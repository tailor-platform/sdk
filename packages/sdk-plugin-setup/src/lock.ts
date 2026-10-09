import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { type AppIds, parseAppIds, TAILOR_LOCK_FILENAME } from "@tailor-platform/sdk/cli";
import * as path from "pathe";

/**
 * Highest lock schema version this plugin understands. Pinned here rather than
 * read from the SDK so an SDK that moves the format on refuses to let an older
 * plugin rewrite the lock.
 */
export const LOCK_VERSION = 2;

const LOCK_FILENAME = TAILOR_LOCK_FILENAME;

function assertSafeLockPath(outputDir: string): void {
  for (const relativePath of [".github", LOCK_FILENAME]) {
    try {
      if (fs.lstatSync(path.join(outputDir, relativePath)).isSymbolicLink()) {
        throw new Error(`Refusing to use ${LOCK_FILENAME}: "${relativePath}" is a symbolic link.`);
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
}

export type TargetKind = "branch" | "tag" | "preview";

type LockApp = {
  dir: string;
  /** Whether this app's tailor-migration-drift-check step was generated (branch/tag only). */
  migrationDriftCheck?: boolean;
  /** Whether this app's tailor-seed-validate step was generated (branch/tag only). */
  seedValidate?: boolean;
  /** TailorDB namespaces this app owns, when ERD preview is enabled (branch only). */
  erdNamespaces?: string[];
};

export type LockInputs = {
  branch: string | null;
  /** True when `branch` was auto-detected (no explicit branch flag). */
  branchAutoDetected?: boolean;
  tagPattern: string | null;
  environment: string;
  dir: string;
  packageManager: string;
  /** For `preview` kind: workspace region used when creating the preview workspace. */
  region?: string;
  /**
   * For `preview` kind: when true, the preview workflow deploys only for PRs labeled
   * `tailor:preview`. False (default) means all PRs trigger a preview deploy.
   */
  requirePreviewLabel?: boolean;
  /**
   * For branch/tag/preview targets given several `--dir`: each app deployed in the one
   * multi-config run, in order. `dir` is then ".".
   */
  apps?: LockApp[];
  /** For branch/preview targets: `--paths` patterns added to the app directories' filter. */
  paths?: string[];
  erdPreview?: boolean;
  erdNamespaces?: string[];
  /** For branch targets: whether the label-triggered migration test job was generated. */
  migrationTest?: boolean;
  /** For branch targets with a migration test: the PR label that triggers it. */
  migrationTestLabel?: string;
  /** For branch targets with a migration test: its dedicated GitHub Environment, if any. */
  migrationTestEnvironment?: string;
  /** Whether tailor-migration-drift-check was generated (config had namespaces with migrations). */
  migrationDriftCheck?: boolean;
  /** Whether tailor-seed-validate was generated (config used seedPlugin). */
  seedValidate?: boolean;
  /** Whether manual dispatch may deploy only the target branch or a tag (branch/tag). */
  restrictDispatch?: boolean;
};

export type LockTarget = {
  kind: TargetKind;
  workspaceName: string;
  /** outputDir-relative, posix-separated path to the generated workflow file. */
  file: string;
  templateVersion: number;
  inputs: LockInputs;
  /** Managed job/step ids: jobs as `<job>`, steps as `<job>/<step>`. */
  generatedIds: string[];
  /** Per-part hashes of the SDK-managed parts, used to name what a hand edit changed. */
  managedHashes?: Record<string, string>;
  /**
   * `managed-v1:sha256:<hex>` of the SDK-managed parts of the rendered file.
   * Entries written by older plugins hold `sha256:<hex>` of the whole file.
   */
  contentHash: string;
};

export type LockFile = {
  version: number;
  targets: LockTarget[];
  /** App ids keyed by repository-relative config path. Absent in version 1 locks. */
  appIds?: AppIds;
};

/**
 * Compute the lock content hash for a rendered workflow file.
 * @param content - File content to hash
 * @returns `sha256:<hex>` digest string
 */
export function hashContent(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf-8").digest("hex")}`;
}

/**
 * Resolve the absolute lock file path for an output directory.
 * @param outputDir - Repository root where `.github` lives
 * @returns Absolute path to the lock file
 */
function lockPath(outputDir: string): string {
  return path.join(outputDir, LOCK_FILENAME);
}

/**
 * Read and validate the lock file from disk.
 *
 * Returns null when no lock exists. Throws when the lock was written by a
 * newer SDK (forward-compatibility guard).
 * @param outputDir - Repository root where `.github` lives
 * @returns Parsed lock file, or null when absent
 */
export function readLock(outputDir: string): LockFile | null {
  assertSafeLockPath(outputDir);
  const file = lockPath(outputDir);
  if (!fs.existsSync(file)) {
    return null;
  }
  let parsed: LockFile;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as LockFile;
  } catch (cause) {
    throw new Error(
      `${LOCK_FILENAME} is not valid JSON. The lock file is machine-owned; ` +
        "restore it from git (git checkout -- .github/tailor.lock) and re-run setup.",
      { cause },
    );
  }
  if (typeof parsed.version !== "number") {
    throw new Error(
      `${LOCK_FILENAME} has no valid 'version' field. The lock file is machine-owned; ` +
        "restore it from git (git checkout -- .github/tailor.lock) and re-run setup.",
    );
  }
  if (parsed.version > LOCK_VERSION) {
    throw new Error(
      `${LOCK_FILENAME} was written by a newer SDK (lock version ${String(parsed.version)}). ` +
        "Update @tailor-platform/sdk and @tailor-platform/sdk-plugin-setup to continue.",
    );
  }
  if (!Array.isArray(parsed.targets)) {
    throw new Error(
      `${LOCK_FILENAME} has no valid 'targets' array. The lock file is machine-owned; ` +
        "restore it from git (git checkout -- .github/tailor.lock) and re-run setup.",
    );
  }
  const removed = parsed.targets.find((t) => {
    const kind: string = t.kind;
    return kind === "coordinate" || kind === "action";
  });
  if (removed) {
    throw new Error(
      `${LOCK_FILENAME} has "${removed.workspaceName}" (${removed.kind}), a target kind that was removed. ` +
        "Delete its generated workflow/action and lock entry, then deploy the apps from one workflow " +
        "with `tailor setup ci branch --dir <a> --dir <b> --name <name>` (or `tag` / `preview`).",
    );
  }
  if (parsed.appIds !== undefined) parseAppIds(parsed.appIds);
  return parsed;
}

/**
 * Write the lock file to disk (2-space JSON, trailing newline).
 * @param outputDir - Repository root where `.github` lives
 * @param lock - Lock file contents to serialize
 */
export function writeLock(outputDir: string, lock: LockFile): void {
  assertSafeLockPath(outputDir);
  const file = lockPath(outputDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`, "utf-8");
}

/**
 * Find a lock target by identity. Targets are identified by (kind,
 * workspaceName); the full trigger/path cross-check is deferred to P2.
 * @param lock - Lock file to search, or null
 * @param kind - Target kind
 * @param workspaceName - Workspace name
 * @returns Matching target, or undefined
 */
export function findTarget(
  lock: LockFile | null,
  kind: TargetKind,
  workspaceName: string,
): LockTarget | undefined {
  return lock?.targets.find((t) => t.kind === kind && t.workspaceName === workspaceName);
}
