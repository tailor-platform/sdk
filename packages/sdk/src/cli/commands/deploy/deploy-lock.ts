/**
 * Application-level deploy lock
 *
 * The operator API's only atomic primitive is a create-only RPC, so the lock
 * is a chain of function registry entries, one per generation: whoever holds
 * the highest existing generation owns the lock. Taking the lock — whether
 * from a released entry or from a holder that stopped heartbeating — means
 * creating the next generation, and `CreateFunctionRegistry` lets exactly one
 * contender win that. The highest entry is never deleted; a release marks it
 * released so the next contender always sees where the chain ends.
 */

import * as crypto from "node:crypto";
import * as os from "node:os";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import {
  Condition_Operator,
  ConditionSchema,
  FilterSchema,
} from "@tailor-platform/tailor-proto/resource_pb";
import pLimit from "p-limit";
import { z } from "zod";
import { bypassConcurrencyLimit, fetchAll, getOrNull, isNotFoundError } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { DeployLockLostError } from "./deploy-lock-error";
import { computeContentHash, uploadFunctionScript } from "./function-registry";
import type { OperatorClient } from "#/cli/shared/client";
import type { FunctionRegistry } from "@tailor-platform/tailor-proto/function_registry_pb";

// The entries deliberately carry no SDK ownership labels: a labeled entry that
// is not part of the desired set is deleted by `planFunctionRegistry`.
const LOCK_NAME_PREFIX = "sdk-deploy-lock--";
const GENERATION_DIGITS = 6;
const LOCK_SCRIPT = "export {};\n";
const LOCK_SCRIPT_HASH = computeContentHash(LOCK_SCRIPT);

const POLL_INTERVAL_MS = 5_000;
const WAIT_TIMEOUT_MS = 10 * 60_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const LEASE_MS = 90_000;

// strip unknown keys
const HeldRecordSchema = z.object({
  v: z.literal(2),
  state: z.literal("held"),
  token: z.string(),
  application: z.string(),
  // strip unknown keys
  holder: z.object({ host: z.string(), pid: z.number(), startedAt: z.string() }),
  heartbeat: z.number(),
});

// strip unknown keys
const ReleasedRecordSchema = z.object({
  v: z.literal(2),
  state: z.literal("released"),
  application: z.string(),
});

const LockRecordSchema = z.union([HeldRecordSchema, ReleasedRecordSchema]);

type HeldRecord = z.infer<typeof HeldRecordSchema>;
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
  /** Throw when another deploy may have taken over any of the held locks. */
  assertHeld(): void;
}

/** One entry of a lock's generation chain, as listed from the workspace. */
interface LockEntry {
  generation: number;
  name: string;
  /** Changes whenever the holder heartbeats, readable record or not. */
  key: string;
  record: LockRecord | undefined;
}

interface HeldLock {
  application: DeployLockApplication;
  prefix: string;
  generation: number;
  name: string;
  record: HeldRecord;
  /** When the entry was last confirmed to be the highest generation. */
  refreshedAt: number;
  lost: boolean;
  /** Serializes the heartbeat against the release on the same entry. */
  serialize: ReturnType<typeof pLimit>;
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
 * Build the name prefix shared by every generation of an application's lock.
 * @param application - Application being deployed
 * @returns Lock name prefix, ending in the generation separator
 */
export function deployLockNamePrefix(application: DeployLockApplication): string {
  const digest = crypto
    .createHash("sha256")
    .update(deployLockIdentity(application), "utf-8")
    .digest("hex");
  return `${LOCK_NAME_PREFIX}${digest.slice(0, 16)}--`;
}

/**
 * Build the name of one generation of an application's lock.
 * @param application - Application being deployed
 * @param generation - Lock generation
 * @returns Lock resource name
 */
export function deployLockResourceName(
  application: DeployLockApplication,
  generation: number,
): string {
  return `${deployLockNamePrefix(application)}${String(generation).padStart(GENERATION_DIGITS, "0")}`;
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

/**
 * Wrap a client so its lock RPCs skip the apply concurrency limiter: a
 * heartbeat queued behind hundreds of apply calls would look like a stopped
 * holder to every waiter.
 * @param client - Operator client instance
 * @returns Client whose calls bypass the limiter
 */
function lockRpcClient(client: OperatorClient): OperatorClient {
  const contextValues = createContextValues().set(bypassConcurrencyLimit, true);
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (input: unknown, options?: object) =>
        (value as (input: unknown, options: object) => unknown).call(target, input, {
          ...options,
          contextValues,
        });
    },
  });
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

function toLockEntry(prefix: string, entry: FunctionRegistry): LockEntry | undefined {
  if (!entry.name.startsWith(prefix)) return undefined;
  const suffix = entry.name.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return undefined;
  const record = parseLockRecord(entry.description);
  let key: string;
  if (record?.state === "held") {
    key = `${record.token}:${record.heartbeat}`;
  } else if (record) {
    key = "released";
  } else {
    key = `opaque:${entry.description}`;
  }
  return { generation: Number(suffix), name: entry.name, key, record };
}

/**
 * List every generation of an application's lock, lowest first.
 * @param client - Lock RPC client
 * @param workspaceId - Workspace ID
 * @param prefix - Lock name prefix
 * @returns Lock entries sorted by generation
 */
async function listLockEntries(
  client: OperatorClient,
  workspaceId: string,
  prefix: string,
): Promise<LockEntry[]> {
  const filter = create(FilterSchema, {
    condition: create(ConditionSchema, {
      field: "name",
      operator: Condition_Operator.CONTAINS,
      value: { kind: { case: "stringValue", value: prefix } },
    }),
  });
  const functions = await fetchAll(async (pageToken, pageSize) => {
    const response = await client.listFunctionRegistries({
      workspaceId,
      pageToken,
      pageSize,
      filter,
    });
    return [response.functions, response.nextPageToken];
  });
  return functions
    .map((entry) => toLockEntry(prefix, entry))
    .filter((entry): entry is LockEntry => entry !== undefined)
    .toSorted((a, b) => a.generation - b.generation);
}

function describeHolder(record: LockRecord | undefined): string {
  if (record?.state !== "held") return "holder record unreadable";
  return `started ${record.holder.startedAt} on ${record.holder.host}, pid ${record.holder.pid}`;
}

/**
 * Acquire one application's lock by creating the next generation once the
 * current one is released or its holder stopped heartbeating.
 * @param client - Lock RPC client
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
  const prefix = deployLockNamePrefix(application);
  const record: HeldRecord = {
    v: 2,
    state: "held",
    token: crypto.randomUUID(),
    application: application.name,
    holder: { host: os.hostname(), pid: process.pid, startedAt: new Date().toISOString() },
    heartbeat: 0,
  };

  let observed: { key: string; since: number } | undefined;
  let announced = false;
  for (;;) {
    const entries = await listLockEntries(client, workspaceId, prefix);
    const top = entries.at(-1);
    const now = Date.now();

    // A record this SDK cannot read still counts as a live holder while it
    // keeps changing.
    const occupied = top !== undefined && top.record?.state !== "released";
    let stale = false;
    if (occupied) {
      if (observed?.key !== top.key) {
        observed = { key: top.key, since: now };
      } else if (now - observed.since >= timing.leaseMs) {
        stale = true;
      }
    }

    if (!occupied || stale) {
      if (stale) {
        logger.info(
          `Reclaiming the deploy lock of "${application.name}" left behind by a deploy that stopped (${describeHolder(top?.record)}).`,
        );
      }
      const generation = (top?.generation ?? 0) + 1;
      const name = deployLockResourceName(application, generation);
      try {
        await writeLockEntry(client, workspaceId, name, record, "create");
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
        // Another contender created this generation first; see who holds it now.
        observed = undefined;
        continue;
      }
      const held: HeldLock = {
        application,
        prefix,
        generation,
        name,
        record,
        refreshedAt: Date.now(),
        lost: false,
        serialize: pLimit(1),
      };
      await removeLowerGenerations(client, workspaceId, held, entries);
      return held;
    }

    if (!announced) {
      logger.info(
        `Another deploy of "${application.name}" is in progress (${describeHolder(top.record)}); waiting for it to finish.`,
      );
      announced = true;
    }
    if (now >= deadline) {
      throw new Error(
        `Timed out waiting for another deploy of "${application.name}" to finish (${describeHolder(top.record)}). ` +
          "Retry once it completes; a deploy that stopped without releasing its lock is reclaimed automatically " +
          `after about ${Math.round(timing.leaseMs / 1000)} seconds.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, timing.pollIntervalMs));
  }
}

/**
 * Delete the generations below the one just acquired. They no longer confer
 * ownership, so a stopped holder that resumes finds its entry gone.
 * @param client - Lock RPC client
 * @param workspaceId - Workspace ID
 * @param held - Lock just acquired
 * @param entries - Entries listed before acquiring
 */
async function removeLowerGenerations(
  client: OperatorClient,
  workspaceId: string,
  held: HeldLock,
  entries: ReadonlyArray<LockEntry>,
): Promise<void> {
  for (const entry of entries) {
    if (entry.generation >= held.generation) continue;
    try {
      await client.deleteFunctionRegistry({ workspaceId, name: entry.name });
    } catch (error) {
      if (isNotFoundError(error)) continue;
      logger.debug(
        `deploy lock: could not remove superseded entry '${entry.name}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function markLost(held: HeldLock, reason: string): void {
  if (held.lost) return;
  held.lost = true;
  logger.warn(
    `The deploy lock of "${held.application.name}" ${reason}. Stopping before the next write.`,
  );
}

/**
 * Refresh one held lock, or mark it lost when a higher generation appeared or
 * the lease ran out without a confirmed refresh.
 * @param client - Lock RPC client
 * @param workspaceId - Workspace ID
 * @param held - Lock to refresh
 * @param leaseMs - Lease length
 */
async function heartbeat(
  client: OperatorClient,
  workspaceId: string,
  held: HeldLock,
  leaseMs: number,
): Promise<void> {
  if (held.lost) return;
  try {
    const entries = await listLockEntries(client, workspaceId, held.prefix);
    if (entries.some((entry) => entry.generation > held.generation)) {
      markLost(held, "was taken over by another deploy after this one stopped refreshing it");
      return;
    }
    const own = entries.find((entry) => entry.generation === held.generation);
    if (own?.record?.state !== "held" || own.record.token !== held.record.token) {
      markLost(held, "entry was removed or rewritten by another deploy");
      return;
    }
    held.record = { ...held.record, heartbeat: held.record.heartbeat + 1 };
    await writeLockEntry(client, workspaceId, held.name, held.record, "update");
    held.refreshedAt = Date.now();
  } catch (error) {
    logger.debug(
      `deploy lock: heartbeat for "${held.application.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (Date.now() - held.refreshedAt >= leaseMs) {
      markLost(
        held,
        `could not be refreshed for over ${Math.round(leaseMs / 1000)} seconds, so another deploy may have taken it over`,
      );
    }
  }
}

/**
 * Mark a held generation released. The entry stays as the end of the chain;
 * marking it is safe even after a takeover, since it is this holder's own
 * generation.
 * @param client - Lock RPC client
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
  const released: LockRecord = { v: 2, state: "released", application: held.application.name };
  try {
    const current = await getOrNull(() =>
      client.getFunctionRegistry({ workspaceId, name: held.name }),
    );
    const record = current?.function ? parseLockRecord(current.function.description) : undefined;
    if (record?.state !== "held" || record.token !== held.record.token) return;
    await writeLockEntry(client, workspaceId, held.name, released, "update");
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
 * Locks are acquired in name order under one shared deadline; when any
 * acquisition fails the ones already held are released again. A heartbeat
 * keeps the held records changing so waiters do not reclaim them, and
 * `lock.assertHeld()` lets the section stop once a takeover was observed or
 * the lease ran out without a confirmed refresh.
 * @param options - Client, workspace, and applications to lock
 * @param fn - Critical section to run while the locks are held
 * @returns The value returned by fn
 */
export async function withDeployLock<T>(
  options: DeployLockOptions,
  fn: (lock: DeployLock) => Promise<T>,
): Promise<T> {
  const { workspaceId } = options;
  const client = lockRpcClient(options.client);
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
        .map((alias) => [deployLockNamePrefix(alias), alias] as const),
    ),
  ]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, application]) => application);

  const held: HeldLock[] = [];
  const releaseAll = async () => {
    for (const lock of held.toReversed()) {
      await lock.serialize(() => releaseLock(client, workspaceId, lock, timing.leaseMs));
    }
  };

  // Heartbeats start before the first acquisition, so a lock held while
  // waiting for another application's lock is refreshed too.
  const timer = setInterval(() => {
    for (const lock of held) {
      if (lock.serialize.activeCount > 0 || lock.serialize.pendingCount > 0) continue;
      void lock.serialize(() => heartbeat(client, workspaceId, lock, timing.leaseMs));
    }
  }, timing.heartbeatIntervalMs);
  timer.unref();

  const stop = async () => {
    clearInterval(timer);
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
      const now = Date.now();
      const lost = held.find((entry) => entry.lost || now - entry.refreshedAt >= timing.leaseMs);
      if (!lost) return;
      throw new DeployLockLostError(
        `Another deploy of "${lost.application.name}" may have taken over the deploy lock while this one was running; ` +
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
