import { AsyncLocalStorage } from "node:async_hooks";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { z } from "zod";
import { CLIError, isCLIError } from "./errors";
import { logger } from "./logger";
import { ensureSecretDir } from "./secret-file";

const REMOTE_LOCK_MAX_AGE_MS = 2 * 60 * 1000;
const LOCAL_LOCK_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = REMOTE_LOCK_MAX_AGE_MS + 30_000;
const UNWRITTEN_LOCK_AGE_MS = 10_000;
const RECLAIM_GUARD_AGE_MS = 10_000;
const WAIT_NOTICE_DELAY_MS = 3_000;
const MAX_RETRY_DELAY_MS = 250;
const PROCESS_START_TOLERANCE_MS = 1_000;
const LOCK_TIMEOUT_CODE = "CONFIG_LOCK_TIMEOUT";

const PROCESS_STARTED_AT = Math.round(Date.now() - process.uptime() * 1000);
const INSTANCE_ID = crypto.randomUUID();

// A lock written by a newer SDK may carry more fields.
const lockOwnerSchema = z.looseObject({
  pid: z.number().int(),
  hostname: z.string(),
  processStartedAt: z.number(),
  instanceId: z.string(),
  nonce: z.string(),
  createdAt: z.number(),
});

type LockOwner = z.output<typeof lockOwnerSchema>;

type ObservedLock = {
  content: string;
  ino: number;
  mtimeMs: number;
  owner: LockOwner | undefined;
};

export type ConfigLockOptions = {
  /** How long to wait for another process to release the lock, in milliseconds. */
  timeoutMs?: number;
};

const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>();
const localQueues = new Map<string, Promise<void>>();

/**
 * Run a callback while holding an exclusive lock that every process on this host respects.
 * Callers in the same process wait their turn, and a callback that is already holding the
 * lock can take it again.
 * @param lockPath - Lock file path
 * @param fn - Callback to run while holding the lock
 * @param options - Lock options
 * @returns The callback's result
 */
export async function withConfigLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: ConfigLockOptions = {},
): Promise<T> {
  const held = heldLocks.getStore();
  if (held?.has(lockPath)) return await fn();

  const previous = localQueues.get(lockPath) ?? Promise.resolve();
  let releaseLocal = () => {};
  const turn = new Promise<void>((resolve) => {
    releaseLocal = resolve;
  });
  const queue = previous.then(() => turn);
  localQueues.set(lockPath, queue);
  await previous;
  try {
    const nonce = await acquireFileLock(lockPath, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      return await heldLocks.run(new Set([...(held ?? []), lockPath]), fn);
    } finally {
      releaseFileLock(lockPath, nonce);
    }
  } finally {
    releaseLocal();
    if (localQueues.get(lockPath) === queue) localQueues.delete(lockPath);
  }
}

/**
 * Whether an error is the timeout {@link withConfigLock} throws when the lock stays held.
 * @param error - Error to check
 * @returns True for a lock timeout
 */
export function isConfigLockTimeout(error: unknown): boolean {
  return isCLIError(error) && error.code === LOCK_TIMEOUT_CODE;
}

async function acquireFileLock(lockPath: string, timeoutMs: number): Promise<string> {
  ensureSecretDir(path.dirname(lockPath));
  const nonce = crypto.randomUUID();
  const startedAt = Date.now();
  let noticeShown = false;
  let delay = 10;
  for (;;) {
    if (tryCreateLock(lockPath, nonce)) return nonce;
    if (reclaimIfStale(lockPath)) continue;
    const waitedMs = Date.now() - startedAt;
    if (waitedMs >= timeoutMs) throw lockTimeoutError(lockPath);
    if (!noticeShown && waitedMs >= WAIT_NOTICE_DELAY_MS) {
      noticeShown = true;
      logger.info(`Waiting for another tailor command to release ${lockPath}...`);
    }
    await new Promise((resolve) => setTimeout(resolve, delay * (0.5 + Math.random())));
    delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
  }
}

function tryCreateLock(lockPath: string, nonce: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  const owner: LockOwner = {
    pid: process.pid,
    hostname: os.hostname(),
    processStartedAt: PROCESS_STARTED_AT,
    instanceId: INSTANCE_ID,
    nonce,
    createdAt: Date.now(),
  };
  try {
    fs.writeSync(fd, JSON.stringify(owner));
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(lockPath, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  return true;
}

function readLock(lockPath: string): ObservedLock | undefined {
  let stat: fs.Stats;
  let content: string;
  try {
    stat = fs.statSync(lockPath);
    content = fs.readFileSync(lockPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return { content, ino: stat.ino, mtimeMs: stat.mtimeMs, owner: parseOwner(content) };
}

function parseOwner(content: string): LockOwner | undefined {
  try {
    const result = lockOwnerSchema.safeParse(JSON.parse(content));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function isStale(lock: ObservedLock): boolean {
  const { owner } = lock;
  const now = Date.now();
  if (!owner) return now - lock.mtimeMs > UNWRITTEN_LOCK_AGE_MS;
  const ageMs = now - owner.createdAt;
  if (owner.hostname !== os.hostname()) return ageMs > REMOTE_LOCK_MAX_AGE_MS;
  if (ageMs > LOCAL_LOCK_MAX_AGE_MS) return true;
  if (owner.pid !== process.pid) return !isProcessAlive(owner.pid);
  // Another thread may hold a lock with this pid; it is left over only if an earlier process or
  // this module, which never acquires while holding, wrote it.
  return (
    Math.abs(owner.processStartedAt - PROCESS_STARTED_AT) > PROCESS_START_TOLERANCE_MS ||
    owner.instanceId === INSTANCE_ID
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Remove a stale lock. Only the process holding the reclaim guard removes it, and only if
 * the lock is still the one judged stale.
 * @param lockPath - Lock file path
 * @returns Whether creating the lock can be retried right away
 */
function reclaimIfStale(lockPath: string): boolean {
  const observed = readLock(lockPath);
  if (!observed) return true;
  if (!isStale(observed)) return false;

  const guardPath = `${lockPath}.reclaim`;
  if (!tryCreateGuard(guardPath)) return false;
  try {
    const current = readLock(lockPath);
    if (
      current?.ino === observed.ino &&
      current.mtimeMs === observed.mtimeMs &&
      current.content === observed.content
    ) {
      fs.rmSync(lockPath, { force: true });
    }
    return true;
  } finally {
    fs.rmSync(guardPath, { force: true });
  }
}

function tryCreateGuard(guardPath: string): boolean {
  try {
    fs.closeSync(fs.openSync(guardPath, "wx", 0o600));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  try {
    if (Date.now() - fs.statSync(guardPath).mtimeMs > RECLAIM_GUARD_AGE_MS) {
      fs.rmSync(guardPath, { force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return false;
}

function releaseFileLock(lockPath: string, nonce: string): void {
  if (readLock(lockPath)?.owner?.nonce === nonce) {
    fs.rmSync(lockPath, { force: true });
  }
}

function lockTimeoutError(lockPath: string): Error {
  return CLIError({
    code: LOCK_TIMEOUT_CODE,
    message: `Timed out waiting for another tailor command to release ${lockPath}.`,
    suggestion:
      "Wait for the other tailor commands to finish, then retry. If none is running, delete the lock file.",
    context: { lockPath },
  });
}
