import { AsyncLocalStorage } from "node:async_hooks";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { z } from "zod";
import { CLIError } from "./errors";
import { ensureSecretDir } from "./secret-file";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_LOCK_AGE_MS = 10 * 60 * 1000;
const UNWRITTEN_LOCK_AGE_MS = 10_000;
const MAX_RETRY_DELAY_MS = 250;

const lockOwnerSchema = z.looseObject({
  pid: z.number().int(),
  hostname: z.string(),
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

async function acquireFileLock(lockPath: string, timeoutMs: number): Promise<string> {
  ensureSecretDir(path.dirname(lockPath));
  const owner: LockOwner = {
    pid: process.pid,
    hostname: os.hostname(),
    nonce: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  const deadline = Date.now() + timeoutMs;
  let delay = 10;
  for (;;) {
    if (tryCreateLock(lockPath, owner)) return owner.nonce;
    if (reclaimIfStale(lockPath)) continue;
    if (Date.now() >= deadline) throw lockTimeoutError(lockPath);
    await new Promise((resolve) => setTimeout(resolve, delay * (0.5 + Math.random())));
    delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
  }
}

function tryCreateLock(lockPath: string, owner: LockOwner): boolean {
  let fd: number;
  try {
    fd = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
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
  const now = Date.now();
  if (!lock.owner) return now - lock.mtimeMs > UNWRITTEN_LOCK_AGE_MS;
  if (now - lock.owner.createdAt > MAX_LOCK_AGE_MS) return true;
  return lock.owner.hostname === os.hostname() && !isProcessAlive(lock.owner.pid);
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
 * Remove a stale lock, putting back a newer lock that replaced it after it was read.
 * @param lockPath - Lock file path
 * @returns Whether the lock file is gone or was replaced, so creating it can be retried now
 */
function reclaimIfStale(lockPath: string): boolean {
  const observed = readLock(lockPath);
  if (!observed) return true;
  if (!isStale(observed)) return false;

  const aside = `${lockPath}.${crypto.randomUUID()}.stale`;
  try {
    fs.renameSync(lockPath, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
  const moved = readLock(aside);
  if (moved && (moved.ino !== observed.ino || moved.content !== observed.content)) {
    restoreLock(aside, lockPath);
  }
  fs.rmSync(aside, { force: true });
  return true;
}

function restoreLock(movedPath: string, lockPath: string): void {
  try {
    fs.linkSync(movedPath, lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

function releaseFileLock(lockPath: string, nonce: string): void {
  if (readLock(lockPath)?.owner?.nonce === nonce) {
    fs.rmSync(lockPath, { force: true });
  }
}

function lockTimeoutError(lockPath: string): Error {
  return CLIError({
    code: "CONFIG_LOCK_TIMEOUT",
    message: `Timed out waiting for another tailor command to release ${lockPath}.`,
    suggestion:
      "Wait for the other tailor commands to finish, then retry. If none is running, delete the lock file.",
    context: { lockPath },
  });
}
