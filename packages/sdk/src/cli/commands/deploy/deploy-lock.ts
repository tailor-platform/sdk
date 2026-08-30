/**
 * Application-level deploy lock
 *
 * The operator API's only atomic primitive is a create-only RPC, so the lock
 * is a function registry entry created with `CreateFunctionRegistry`. The
 * holder's record lives in the entry's description and a heartbeat keeps
 * changing it; a waiter that sees the description unchanged for a whole lease
 * reclaims the entry as abandoned.
 */

import * as crypto from "node:crypto";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { getOrNull, isNotFoundError } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { DeployLockLostError } from "./deploy-lock-error";
import { computeContentHash, uploadFunctionScript } from "./function-registry";
import type { OperatorClient } from "#/cli/shared/client";

// The entry deliberately carries no SDK ownership labels: a labeled entry that
// is not part of the desired set is deleted by `planFunctionRegistry`.
const LOCK_NAME_PREFIX = "sdk-deploy-lock--";
const LOCK_SCRIPT = "export {};\n";
const LOCK_SCRIPT_HASH = computeContentHash(LOCK_SCRIPT);

const POLL_INTERVAL_MS = 5_000;
const WAIT_TIMEOUT_MS = 10 * 60_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const LEASE_MS = 90_000;

// strip unknown keys
const LockRecordSchema = z.object({
  v: z.literal(1),
  token: z.string(),
  application: z.string(),
  // strip unknown keys
  holder: z.object({ host: z.string(), pid: z.number(), startedAt: z.string() }),
  heartbeat: z.number(),
});

type LockRecord = z.infer<typeof LockRecordSchema>;

export interface DeployLockApplication {
  name: string;
  id?: string | undefined;
}

interface DeployLockTiming {
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  leaseMs?: number;
}

export interface DeployLockOptions {
  client: OperatorClient;
  workspaceId: string;
  applications: ReadonlyArray<DeployLockApplication>;
  timing?: DeployLockTiming;
}

export interface DeployLock {
  /** Throw when another deploy has taken over any of the held locks. */
  assertHeld(): void;
}

interface HeldLock {
  application: DeployLockApplication;
  name: string;
  record: LockRecord;
  lost: boolean;
}

/**
 * What a waiter can see of the current lock entry. `key` changes whenever the
 * holder heartbeats, whether or not the record is one this SDK can read.
 */
interface LockObservation {
  key: string;
  record: LockRecord | undefined;
}

/**
 * Identity a lock is keyed by: the application id when the config declares
 * one, otherwise the name. A rename in progress keeps the same id, so both
 * names contend for the same lock.
 * @param application - Application being deployed
 * @returns Lock identity
 */
function deployLockIdentity(application: DeployLockApplication): string {
  return application.id ?? `name:${application.name}`;
}

/**
 * The identities one application must hold: its id, and always its name, so
 * a config that has not been given an id yet contends with one that has.
 * @param application - Application being deployed
 * @returns Lock identities to acquire
 */
function deployLockAliases(application: DeployLockApplication): DeployLockApplication[] {
  return application.id ? [{ name: application.name }, application] : [application];
}

/**
 * Build the function registry name of an application's deploy lock.
 * @param application - Application being deployed
 * @returns Lock resource name
 */
export function deployLockResourceName(application: DeployLockApplication): string {
  const digest = crypto
    .createHash("sha256")
    .update(deployLockIdentity(application), "utf-8")
    .digest("hex");
  return `${LOCK_NAME_PREFIX}${digest.slice(0, 16)}`;
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof ConnectError && error.code === Code.AlreadyExists;
}

function parseLockRecord(description: string): LockRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(description);
  } catch {
    return undefined;
  }
  const result = LockRecordSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

async function writeLockEntry(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  record: LockRecord,
  mode: "create" | "update",
): Promise<void> {
  await uploadFunctionScript(
    client,
    workspaceId,
    {
      name,
      scriptContent: LOCK_SCRIPT,
      contentHash: LOCK_SCRIPT_HASH,
      description: JSON.stringify(record),
    },
    mode === "create",
  );
}

async function observeLock(
  client: OperatorClient,
  workspaceId: string,
  name: string,
): Promise<LockObservation | undefined> {
  const response = await getOrNull(() => client.getFunctionRegistry({ workspaceId, name }));
  if (!response?.function) return undefined;
  const description = response.function.description;
  const record = parseLockRecord(description);
  return {
    key: record ? `${record.token}:${record.heartbeat}` : `opaque:${description}`,
    record,
  };
}

function describeHolder(record: LockRecord | undefined): string {
  if (!record) return "holder record unreadable";
  return `started ${record.holder.startedAt} on ${record.holder.host}, pid ${record.holder.pid}`;
}

/**
 * Acquire one application's lock, waiting for a live holder and reclaiming an
 * abandoned one.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param application - Application to lock
 * @param deadline - Epoch milliseconds after which waiting gives up
 * @param timing - Poll interval and lease length
 * @returns The held lock
 */
async function acquireLock(
  client: OperatorClient,
  workspaceId: string,
  application: DeployLockApplication,
  deadline: number,
  timing: Required<DeployLockTiming>,
): Promise<HeldLock> {
  const name = deployLockResourceName(application);
  const record: LockRecord = {
    v: 1,
    token: crypto.randomUUID(),
    application: application.name,
    holder: { host: os.hostname(), pid: process.pid, startedAt: new Date().toISOString() },
    heartbeat: 0,
  };

  let observed: { key: string; since: number } | undefined;
  let announced = false;
  for (;;) {
    try {
      await writeLockEntry(client, workspaceId, name, record, "create");
      return { application, name, record, lost: false };
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }

    // The entry can be gone again by the time it is read (released, reclaimed,
    // or not yet visible); that still counts as a poll, not a free retry.
    const current = await observeLock(client, workspaceId, name);
    const now = Date.now();
    if (!current) {
      observed = undefined;
    } else if (observed?.key !== current.key) {
      observed = { key: current.key, since: now };
    } else if (now - observed.since >= timing.leaseMs) {
      logger.info(
        `Reclaiming the deploy lock of "${application.name}" left behind by a deploy that stopped (${describeHolder(current.record)}).`,
      );
      await reclaimLock(client, workspaceId, name, observed.key);
      observed = undefined;
      continue;
    }

    if (current && !announced) {
      logger.info(
        `Another deploy of "${application.name}" is in progress (${describeHolder(current.record)}); waiting for it to finish.`,
      );
      announced = true;
    }
    if (now >= deadline) {
      throw new Error(
        `Timed out waiting for another deploy of "${application.name}" to finish (${describeHolder(current?.record)}). ` +
          "Retry once it completes; a deploy that stopped without releasing its lock is reclaimed automatically " +
          `after about ${Math.round(timing.leaseMs / 1000)} seconds.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, timing.pollIntervalMs));
  }
}

/**
 * Delete an abandoned lock entry, unless its holder resumed or another
 * waiter already replaced it.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param name - Lock resource name
 * @param staleKey - Observation key that stayed unchanged for a whole lease
 */
async function reclaimLock(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  staleKey: string,
): Promise<void> {
  const latest = await observeLock(client, workspaceId, name);
  if (latest?.key !== staleKey) return;
  try {
    await client.deleteFunctionRegistry({ workspaceId, name });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

/**
 * Refresh one held lock, or mark it lost when another deploy took it over.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param held - Lock to refresh
 * @param leaseMs - Lease length, for the takeover warning
 */
async function heartbeat(
  client: OperatorClient,
  workspaceId: string,
  held: HeldLock,
  leaseMs: number,
): Promise<void> {
  if (held.lost) return;
  try {
    const current = await observeLock(client, workspaceId, held.name);
    if (current?.record?.token !== held.record.token) {
      held.lost = true;
      logger.warn(
        `The deploy lock of "${held.application.name}" was taken over by another deploy after this one ` +
          `stopped refreshing it for over ${Math.round(leaseMs / 1000)} seconds. Stopping before the next apply phase.`,
      );
      return;
    }
    held.record = { ...held.record, heartbeat: held.record.heartbeat + 1 };
    await writeLockEntry(client, workspaceId, held.name, held.record, "update");
  } catch (error) {
    // A slow or failed refresh is not evidence of a takeover; the next
    // successful read is, and release stays token-checked either way.
    logger.debug(
      `deploy lock: heartbeat for "${held.application.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Delete a held lock entry, unless it was already taken over.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param held - Lock to release
 * @param leaseMs - Lease length, for the failure warning
 */
async function releaseLock(
  client: OperatorClient,
  workspaceId: string,
  held: HeldLock,
  leaseMs: number,
): Promise<void> {
  if (held.lost) return;
  try {
    const current = await observeLock(client, workspaceId, held.name);
    if (current?.record?.token !== held.record.token) return;
    await client.deleteFunctionRegistry({ workspaceId, name: held.name });
  } catch (error) {
    if (isNotFoundError(error)) return;
    logger.warn(
      `Could not release the deploy lock of "${held.application.name}": ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        `The next deploy reclaims it automatically after about ${Math.round(leaseMs / 1000)} seconds.`,
    );
  }
}

/**
 * Run a deploy-time critical section while holding every application's locks.
 *
 * Locks are acquired in resource-name order under one shared deadline; when
 * any acquisition fails the ones already held are released again. A heartbeat
 * keeps the held records changing so waiters do not reclaim them, and
 * `lock.assertHeld()` lets the section stop once a takeover was observed.
 * @param options - Client, workspace, and applications to lock
 * @param fn - Critical section to run while the locks are held
 * @returns The value returned by fn
 */
export async function withDeployLock<T>(
  options: DeployLockOptions,
  fn: (lock: DeployLock) => Promise<T>,
): Promise<T> {
  const { client, workspaceId } = options;
  const timing: Required<DeployLockTiming> = {
    pollIntervalMs: options.timing?.pollIntervalMs ?? POLL_INTERVAL_MS,
    waitTimeoutMs: options.timing?.waitTimeoutMs ?? WAIT_TIMEOUT_MS,
    heartbeatIntervalMs: options.timing?.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
    leaseMs: options.timing?.leaseMs ?? LEASE_MS,
  };

  const applications = [
    ...new Map(
      options.applications
        .flatMap(deployLockAliases)
        .map((alias) => [deployLockResourceName(alias), alias] as const),
    ),
  ]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, application]) => application);

  const held: HeldLock[] = [];
  const releaseAll = async () => {
    for (const lock of held.toReversed()) {
      await releaseLock(client, workspaceId, lock, timing.leaseMs);
    }
  };

  // Heartbeats start before the first acquisition, so a lock held while
  // waiting for another application's lock is refreshed too.
  let heartbeatInFlight: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = (async () => {
      for (const lock of held) {
        await heartbeat(client, workspaceId, lock, timing.leaseMs);
      }
    })().finally(() => {
      heartbeatInFlight = undefined;
    });
  }, timing.heartbeatIntervalMs);
  timer.unref();

  const stop = async () => {
    clearInterval(timer);
    // A heartbeat still in flight would read the entry after release deleted
    // it and misreport a takeover; a hung one must not hold the release up.
    await Promise.race([
      heartbeatInFlight,
      new Promise((resolve) => setTimeout(resolve, timing.heartbeatIntervalMs).unref()),
    ]);
    await releaseAll();
  };

  const deadline = Date.now() + timing.waitTimeoutMs;
  try {
    for (const application of applications) {
      held.push(await acquireLock(client, workspaceId, application, deadline, timing));
    }
  } catch (error) {
    await stop();
    throw error;
  }

  const lock: DeployLock = {
    assertHeld: () => {
      const lost = held.find((entry) => entry.lost);
      if (!lost) return;
      throw new DeployLockLostError(
        `Another deploy of "${lost.application.name}" took over the deploy lock while this one was running; ` +
          "stopping to avoid applying conflicting changes. Rerun the deploy once it finishes.",
      );
    },
  };

  try {
    return await fn(lock);
  } finally {
    await stop();
  }
}
