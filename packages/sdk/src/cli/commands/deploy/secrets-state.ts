import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import pLimit, { type LimitFunction } from "p-limit";
import * as path from "pathe";
import { z } from "zod";
import { getDistDir } from "#/cli/shared/dist-dir";

const SecretsStateSchema = z.object({
  vaults: z.record(z.string(), z.record(z.string(), z.string())),
  connections: z.record(z.string(), z.string()).optional(),
});

const PersistedSecretsStateSchema = z.object({
  version: z.literal(1),
  workspaceId: z.string(),
  applicationKey: z.string(),
  state: SecretsStateSchema,
});

export type SecretsState = z.infer<typeof SecretsStateSchema>;
type PersistedSecretsState = z.infer<typeof PersistedSecretsStateSchema>;

export interface SecretsStateScope {
  readonly workspaceId: string;
  readonly applicationId: string | undefined;
  readonly applicationName: string;
}

/**
 * Get the file path for one workspace and application's secrets state JSON.
 * @param scope - Workspace and application identity for the deployment
 * @returns Absolute path to the scoped state file
 */
export function getSecretsStatePath(scope: SecretsStateScope): string {
  const scopeHash = hashValue(JSON.stringify([scope.workspaceId, applicationStateKey(scope)]));
  return path.join(getDistDir(), "secrets-state", `${scopeHash}.json`);
}

function loadPersistedSecretsState(scope: SecretsStateScope): PersistedSecretsState | undefined {
  try {
    const raw = readFileSync(getSecretsStatePath(scope), "utf-8");
    const persistedState = PersistedSecretsStateSchema.parse(JSON.parse(raw));
    if (
      persistedState.workspaceId !== scope.workspaceId ||
      persistedState.applicationKey !== applicationStateKey(scope)
    ) {
      return undefined;
    }
    return persistedState;
  } catch {
    return undefined;
  }
}

function applicationStateKey(scope: SecretsStateScope): string {
  if (!scope.applicationId) {
    throw new Error(`Application "${scope.applicationName}" has no stable id for secrets state`);
  }
  return `id:${scope.applicationId}`;
}

/**
 * Load secrets hash state for one workspace and application from disk.
 * @param scope - Workspace and application identity for the deployment
 * @returns Persisted state, or empty state if the scope is missing or the file is invalid
 */
export function loadSecretsState(scope: SecretsStateScope): SecretsState {
  if (!scope.applicationId) {
    return { vaults: {} };
  }
  return loadPersistedSecretsState(scope)?.state ?? { vaults: {} };
}

/**
 * Save secrets hash state for one workspace and application to disk.
 * @param scope - Workspace and application identity for the deployment
 * @param state - The secrets state to persist
 */
export function saveSecretsState(scope: SecretsStateScope, state: SecretsState): void {
  if (!scope.applicationId) {
    return;
  }
  const filePath = getSecretsStatePath(scope);
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  // Write via a temp file and rename so concurrent readers never see torn JSON.
  const tempPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(
    tempPath,
    JSON.stringify(
      {
        version: 1,
        workspaceId: scope.workspaceId,
        applicationKey: applicationStateKey(scope),
        state,
      } satisfies PersistedSecretsState,
      null,
      2,
    ),
    "utf-8",
  );
  renameSync(tempPath, filePath);
}

/**
 * Compute SHA-256 hex digest of a value.
 * @param value - The string to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const LOCK_POLL_INTERVAL_MS = 100;
const LOCK_ACQUIRE_TIMEOUT_MS = 5 * 60 * 1000;
const OWNERLESS_LOCK_GRACE_MS = 10 * 1000;

const lockQueues = new Map<string, LimitFunction>();

/**
 * Run a remote-update/state-save sequence exclusively for one target's secrets state.
 *
 * Serializes concurrent deploys to the same workspace and application (across
 * processes sharing the same output directory) so the persisted hash state
 * always reflects the last remote write.
 * @param scope - Workspace and application identity for the deployment
 * @param fn - Critical section performing remote updates and the state save
 * @returns The value returned by fn
 */
export async function withSecretsStateLock<T>(
  scope: SecretsStateScope,
  fn: () => Promise<T>,
): Promise<T> {
  if (!scope.applicationId) {
    return fn();
  }
  const lockPath = `${getSecretsStatePath(scope)}.lock`;
  let queue = lockQueues.get(lockPath);
  if (!queue) {
    queue = pLimit(1);
    lockQueues.set(lockPath, queue);
  }
  return queue(async () => {
    await acquireFileLock(lockPath);
    try {
      return await fn();
    } finally {
      rmSync(lockPath, { recursive: true, force: true });
    }
  });
}

async function acquireFileLock(lockPath: string): Promise<void> {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  for (;;) {
    let created = true;
    try {
      mkdirSync(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      created = false;
    }
    if (created) {
      try {
        writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid }));
      } catch (error) {
        rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }
      return;
    }
    if (isLockStale(lockPath)) {
      stealLock(lockPath);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for the secrets state lock at "${lockPath}". ` +
          "Another deploy to the same workspace and application may still be running; " +
          "remove the lock directory if no such deploy exists.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
  }
}

function isLockStale(lockPath: string): boolean {
  let pid: unknown;
  try {
    pid = (
      JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf-8")) as { pid?: unknown }
    ).pid;
  } catch {
    // The holder may still be between creating the directory and writing
    // owner.json; only treat a persistently ownerless lock as stale.
    try {
      return Date.now() - statSync(lockPath).mtimeMs > OWNERLESS_LOCK_GRACE_MS;
    } catch {
      return false;
    }
  }
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code !== "EPERM";
  }
}

function stealLock(lockPath: string): void {
  // Rename first so concurrent stealers cannot remove a lock that another
  // contender has just re-acquired.
  const trash = `${lockPath}.stale-${process.pid}-${Date.now()}`;
  try {
    renameSync(lockPath, trash);
  } catch {
    return;
  }
  if (isLockStale(trash)) {
    rmSync(trash, { recursive: true, force: true });
    return;
  }
  // A live holder re-acquired the lock between the staleness check and the
  // rename; hand it back.
  try {
    renameSync(trash, lockPath);
  } catch {
    rmSync(trash, { recursive: true, force: true });
  }
}
