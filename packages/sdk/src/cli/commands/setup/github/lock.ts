import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "pathe";

/** Current lock schema version. Bumped only on breaking lock-format changes. */
export const LOCK_VERSION = 1;

/** Lock file path, relative to the repository root. */
const LOCK_FILENAME = ".github/tailor-sdk.lock";

export type TargetKind = "branch" | "tag";

export type LockInputs = {
  workspaceRegion: string;
  organizationId: string;
  folderId: string | null;
  branch: string | null;
  tagPattern: string | null;
  environment: string | null;
  dir: string;
  packageManager: string;
  plan: boolean;
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
  /** Reserved for future eject semantics; preserved as-is across regenerations. */
  ejectedIds: string[];
  /** `sha256:<hex>` of the written file content. */
  contentHash: string;
};

export type LockFile = {
  version: number;
  targets: LockTarget[];
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
export function lockPath(outputDir: string): string {
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
        "restore it from git (git checkout -- .github/tailor-sdk.lock) and re-run setup.",
      { cause },
    );
  }
  if (typeof parsed.version !== "number" || parsed.version > LOCK_VERSION) {
    throw new Error(
      `${LOCK_FILENAME} was written by a newer SDK (lock version ${String(parsed.version)}). ` +
        "Update the SDK to continue: pnpm update @tailor-platform/sdk",
    );
  }
  return parsed;
}

/**
 * Write the lock file to disk (2-space JSON, trailing newline).
 * @param outputDir - Repository root where `.github` lives
 * @param lock - Lock file contents to serialize
 */
export function writeLock(outputDir: string, lock: LockFile): void {
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
