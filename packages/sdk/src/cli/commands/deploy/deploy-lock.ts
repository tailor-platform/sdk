/**
 * Application-level deploy lock
 *
 * The operator API has no conditional writes, so two deploys of the same
 * application interleave freely: each plans against a snapshot the other is
 * changing, and shared writes (metadata labels, migration checkpoints,
 * temporary migration resources) are last-writer-wins. Create-only RPCs are
 * the one atomic primitive, so the lock is a function registry entry created
 * with `CreateFunctionRegistry`: the holder's identity lives in the entry's
 * description, a heartbeat keeps changing it, and a waiter that sees the
 * description unchanged for a whole lease reclaims the entry as abandoned.
 */

import * as crypto from "node:crypto";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import { getOrNull, isNotFoundError } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import type { OperatorClient } from "#/cli/shared/client";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  CreateFunctionRegistryRequestSchema,
  UpdateFunctionRegistryRequestSchema,
} from "@tailor-platform/tailor-proto/function_registry_pb";

// The entry deliberately carries no SDK ownership labels: a labeled entry that
// is not part of the desired set is deleted by `planFunctionRegistry`.
const LOCK_NAME_PREFIX = "sdk-deploy-lock--";
const LOCK_SCRIPT = "export {};\n";

const POLL_INTERVAL_MS = 5_000;
const WAIT_TIMEOUT_MS = 10 * 60_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const LEASE_MS = 90_000;

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

interface LockRecord {
  v: 1;
  token: string;
  application: string;
  holder: { host: string; pid: number; startedAt: string };
  heartbeat: number;
}

interface HeldLock {
  application: DeployLockApplication;
  name: string;
  record: LockRecord;
  lost: boolean;
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

function parseLockRecord(description: string | undefined): LockRecord | undefined {
  if (!description) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(description);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  const holder = record.holder as Record<string, unknown> | null | undefined;
  if (
    record.v !== 1 ||
    typeof record.token !== "string" ||
    typeof record.application !== "string" ||
    typeof record.heartbeat !== "number" ||
    typeof holder !== "object" ||
    holder === null ||
    typeof holder.host !== "string" ||
    typeof holder.pid !== "number" ||
    typeof holder.startedAt !== "string"
  ) {
    return undefined;
  }
  return {
    v: 1,
    token: record.token,
    application: record.application,
    heartbeat: record.heartbeat,
    holder: { host: holder.host, pid: holder.pid, startedAt: holder.startedAt },
  };
}

/**
 * Write the lock entry, either creating it (which fails when another deploy
 * holds the lock) or refreshing the holder's record.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param name - Lock resource name
 * @param record - Holder record to store in the entry's description
 * @param mode - Whether to create the entry or update the existing one
 */
async function writeLockEntry(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  record: LockRecord,
  mode: "create" | "update",
): Promise<void> {
  const buffer = Buffer.from(LOCK_SCRIPT, "utf-8");
  const info = {
    workspaceId,
    name,
    description: JSON.stringify(record),
    sizeBytes: BigInt(buffer.length),
    contentHash: crypto.createHash("sha256").update(LOCK_SCRIPT, "utf-8").digest("hex"),
  };

  if (mode === "create") {
    /** @yields {MessageInitShape<typeof CreateFunctionRegistryRequestSchema>} Info header followed by the script */
    async function* createStream(): AsyncIterable<
      MessageInitShape<typeof CreateFunctionRegistryRequestSchema>
    > {
      yield { payload: { case: "info" as const, value: info } };
      yield { payload: { case: "chunk" as const, value: buffer } };
    }
    await client.createFunctionRegistry(createStream());
  } else {
    /** @yields {MessageInitShape<typeof UpdateFunctionRegistryRequestSchema>} Info header followed by the script */
    async function* updateStream(): AsyncIterable<
      MessageInitShape<typeof UpdateFunctionRegistryRequestSchema>
    > {
      yield { payload: { case: "info" as const, value: info } };
      yield { payload: { case: "chunk" as const, value: buffer } };
    }
    await client.updateFunctionRegistry(updateStream());
  }
}

async function readLockRecord(
  client: OperatorClient,
  workspaceId: string,
  name: string,
): Promise<{ exists: boolean; record: LockRecord | undefined }> {
  const response = await getOrNull(() => client.getFunctionRegistry({ workspaceId, name }));
  if (!response?.function) return { exists: false, record: undefined };
  return { exists: true, record: parseLockRecord(response.function.description) };
}

function describeHolder(record: LockRecord): string {
  return `started ${record.holder.startedAt} on ${record.holder.host}`;
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

  let observed: { token: string; heartbeat: number; since: number } | undefined;
  let announced = false;
  for (;;) {
    try {
      await writeLockEntry(client, workspaceId, name, record, "create");
      return { application, name, record, lost: false };
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }

    const current = await readLockRecord(client, workspaceId, name);
    if (!current.exists) continue;
    if (!current.record) {
      throw new Error(
        `Function '${name}' occupies the deploy lock slot of "${application.name}" but was not written by the SDK. ` +
          "Delete that function from the workspace and retry.",
      );
    }

    const now = Date.now();
    if (
      !observed ||
      observed.token !== current.record.token ||
      observed.heartbeat !== current.record.heartbeat
    ) {
      observed = { token: current.record.token, heartbeat: current.record.heartbeat, since: now };
    } else if (now - observed.since >= timing.leaseMs) {
      logger.info(
        `Reclaiming the deploy lock of "${application.name}" left behind by a deploy that stopped (${describeHolder(current.record)}).`,
      );
      await reclaimLock(client, workspaceId, name, observed);
      observed = undefined;
      continue;
    }

    if (!announced) {
      logger.info(
        `Another deploy of "${application.name}" is in progress (${describeHolder(current.record)}); waiting for it to finish.`,
      );
      announced = true;
    }
    if (now >= deadline) {
      throw new Error(
        `Timed out waiting for another deploy of "${application.name}" to finish (${describeHolder(current.record)}). ` +
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
 * @param stale - Token and heartbeat observed as unchanged for a whole lease
 */
async function reclaimLock(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  stale: { token: string; heartbeat: number },
): Promise<void> {
  const latest = await readLockRecord(client, workspaceId, name);
  if (
    !latest.exists ||
    !latest.record ||
    latest.record.token !== stale.token ||
    latest.record.heartbeat !== stale.heartbeat
  ) {
    return;
  }
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
    const current = await readLockRecord(client, workspaceId, held.name);
    if (!current.exists || current.record?.token !== held.record.token) {
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
    const current = await readLockRecord(client, workspaceId, held.name);
    if (!current.exists || current.record?.token !== held.record.token) return;
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
 * Run a deploy-time critical section while holding every application's lock.
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
      options.applications.map((application) => [deployLockResourceName(application), application]),
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

  const deadline = Date.now() + timing.waitTimeoutMs;
  try {
    for (const application of applications) {
      held.push(await acquireLock(client, workspaceId, application, deadline, timing));
    }
  } catch (error) {
    await releaseAll();
    throw error;
  }

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

  const lock: DeployLock = {
    assertHeld: () => {
      const lost = held.find((entry) => entry.lost);
      if (!lost) return;
      throw new Error(
        `Another deploy of "${lost.application.name}" took over the deploy lock while this one was running; ` +
          "stopping to avoid applying conflicting changes. Rerun the deploy once it finishes.",
      );
    },
  };

  try {
    return await fn(lock);
  } finally {
    clearInterval(timer);
    // A heartbeat still in flight would read the entry after release deleted
    // it and misreport a takeover.
    await heartbeatInFlight;
    await releaseAll();
  }
}
