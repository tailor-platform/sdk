import * as fs from "node:fs";
import * as path from "pathe";
import { isCI } from "std-env";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { parseBoolean } from "#/cli/shared/parse-boolean";
import { canPrompt, prompt } from "#/cli/shared/prompt";
import { assertDefined } from "#/utils/assert";
import { removeConfigId, uuidRegex } from "./config-id-injector";

/** Lock file path, relative to the repository root. Created by `tailor setup`. */
export const TAILOR_LOCK_FILENAME = ".github/tailor.lock";

/**
 * Current lock schema version. Version 2 added `appIds`; a lock carrying it
 * must not be rewritten by a tool that would drop the section.
 */
export const TAILOR_LOCK_VERSION = 2;

const restoreHint =
  "The lock file is machine-owned; restore it from git " +
  `(git checkout -- ${TAILOR_LOCK_FILENAME}) and re-run setup.`;

/** App ids recorded in the lock, keyed by repository-relative config path. */
export type AppIds = Readonly<Record<string, string>>;

/** The `appIds` section of a repository's lock file. */
export type AppIdLock = {
  /** Repository root: the directory that holds `.github/tailor.lock`. */
  root: string;
  appIds: AppIds;
};

type RawLock = { version: number; appIds?: unknown } & Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRepositoryRelativeKey(key: string): boolean {
  if (key === "" || path.isAbsolute(key) || key.includes("\\")) return false;
  return key.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function assertSafeLockPath(root: string): void {
  for (const relativePath of [".github", TAILOR_LOCK_FILENAME]) {
    try {
      if (fs.lstatSync(path.join(root, relativePath)).isSymbolicLink()) {
        throw CLIError({
          code: "APP_ID_LOCK_INVALID",
          message: `Refusing to use ${TAILOR_LOCK_FILENAME}: "${relativePath}" is a symbolic link.`,
        });
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
}

/**
 * Validate the `appIds` section of a lock file.
 *
 * Every key must be a repository-relative config path and every value a UUID.
 * Two configs must not share one id: that is the copied-config accident the
 * lock exists to prevent, so it is rejected instead of deployed.
 * @param value - The raw `appIds` value, or undefined when the lock has none
 * @returns The validated section (empty when absent)
 */
export function parseAppIds(value: unknown): AppIds {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    throw CLIError({
      code: "APP_ID_LOCK_INVALID",
      message: `${TAILOR_LOCK_FILENAME} has an invalid 'appIds' section: expected an object mapping config paths to app ids.`,
      suggestion: restoreHint,
    });
  }
  const owners = new Map<string, string>();
  for (const [key, id] of Object.entries(value)) {
    if (!isRepositoryRelativeKey(key)) {
      throw CLIError({
        code: "APP_ID_LOCK_INVALID",
        message: `${TAILOR_LOCK_FILENAME} 'appIds' key "${key}" must be a repository-relative config path (no absolute paths, "..", or backslashes).`,
        suggestion: restoreHint,
      });
    }
    if (typeof id !== "string" || !uuidRegex.test(id)) {
      throw CLIError({
        code: "APP_ID_LOCK_INVALID",
        message: `${TAILOR_LOCK_FILENAME} 'appIds' entry for "${key}" must be a UUID.`,
        suggestion: restoreHint,
      });
    }
    const owner = owners.get(id.toLowerCase());
    if (owner !== undefined) {
      throw CLIError({
        code: "APP_ID_CONFLICT",
        message: `${TAILOR_LOCK_FILENAME} records the same app id "${id}" for "${owner}" and "${key}".`,
        suggestion:
          "Each config needs its own app id: delete the entry of the copied config so the next local deploy assigns a fresh one.",
      });
    }
    owners.set(id.toLowerCase(), key);
  }
  return value as AppIds;
}

function readRawLock(root: string): RawLock | null {
  assertSafeLockPath(root);
  const file = path.join(root, TAILOR_LOCK_FILENAME);
  if (!fs.existsSync(file)) return null;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch (cause) {
    throw CLIError({
      code: "APP_ID_LOCK_UNREADABLE",
      message: `${TAILOR_LOCK_FILENAME} under ${root} could not be read.`,
      cause,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw CLIError({
      code: "APP_ID_LOCK_INVALID",
      message: `${TAILOR_LOCK_FILENAME} is not valid JSON.`,
      suggestion: restoreHint,
      cause,
    });
  }
  if (!isPlainObject(parsed) || typeof parsed.version !== "number") {
    throw CLIError({
      code: "APP_ID_LOCK_INVALID",
      message: `${TAILOR_LOCK_FILENAME} has no valid 'version' field.`,
      suggestion: restoreHint,
    });
  }
  if (parsed.version > TAILOR_LOCK_VERSION) {
    throw CLIError({
      code: "APP_ID_LOCK_VERSION_UNSUPPORTED",
      message: `${TAILOR_LOCK_FILENAME} was written by a newer SDK (lock version ${String(parsed.version)}).`,
      suggestion: "Update @tailor-platform/sdk and @tailor-platform/sdk-plugin-setup to continue.",
    });
  }
  return parsed as RawLock;
}

/**
 * Read the `appIds` section of the lock file under a repository root.
 * @param root - Directory that holds `.github/tailor.lock`
 * @returns The lock, or null when the repository has none
 */
export function readAppIdLock(root: string): AppIdLock | null {
  const raw = readRawLock(root);
  if (raw === null) return null;
  return { root, appIds: parseAppIds(raw.appIds) };
}

/**
 * Locate the lock file that governs a config: the nearest `.github/tailor.lock`
 * in the config's directory or one of its ancestors, without leaving the
 * repository the config belongs to. That is the root setup records against
 * when it runs from that directory.
 * @param configPath - Absolute path to the config file
 * @returns The lock, or null when no ancestor directory inside the repository has one
 */
export function findAppIdLock(configPath: string): AppIdLock | null {
  let dir = path.dirname(configPath);
  for (;;) {
    if (fs.existsSync(path.join(dir, TAILOR_LOCK_FILENAME))) return readAppIdLock(dir);
    const parent = path.dirname(dir);
    if (parent === dir || fs.existsSync(path.join(dir, ".git"))) return null;
    dir = parent;
  }
}

/**
 * The `appIds` key of a config: its path relative to the repository root, with
 * `/` separators.
 * @param root - Directory that holds `.github/tailor.lock`
 * @param configPath - Absolute path to the config file
 * @returns The lock key
 */
export function appIdLockKey(root: string, configPath: string): string {
  const key = path.relative(root, configPath);
  if (!isRepositoryRelativeKey(key)) {
    throw CLIError({
      code: "CONFIG_OUTSIDE_REPOSITORY",
      message: `${configPath} is outside the repository that holds ${TAILOR_LOCK_FILENAME} (${root}).`,
    });
  }
  return key;
}

/** Inputs to {@link resolveAppId}. */
export type ResolveAppIdParams = {
  configPath: string;
  configId: string | undefined;
};

/**
 * Resolve a config's app id for a plugin that only needs to read it: the same
 * lock-first precedence `deploy` applies (see {@link planAppIds}), scoped to
 * one config, with no lock write, config edit, or prompt. A config whose id
 * is not yet recorded anywhere resolves to undefined rather than warning —
 * unlike a deploy or remove run, a plugin resolving this has no ownership
 * decision riding on it, so the warning `planAppIds` raises for that case
 * would be misleading here. A config id that disagrees with the lock, or
 * that is already recorded for a different, still-existing config, is an
 * `APP_ID_CONFLICT` — the same ambiguous states `planAppIds` refuses to
 * resolve automatically, since a plugin trusting the wrong side would act on
 * another application's identity. A defined `configId` that is not itself a
 * UUID is a `CONFIG_ID_INVALID` error, regardless of whether a lock governs
 * the config, so a malformed value never comes back as a resolved id.
 * @param params - The config to resolve and the id its module evaluates to, if any
 * @returns The resolved id, or undefined when neither the lock nor the config carries one
 */
export function resolveAppId(params: ResolveAppIdParams): string | undefined {
  const { configPath, configId } = params;
  if (configId !== undefined && !uuidRegex.test(configId)) {
    throw configIdInvalid(configPath);
  }

  const lock = findAppIdLock(configPath);
  if (lock === null) return configId;

  const key = appIdLockKey(lock.root, configPath);
  const recorded = lock.appIds[key];
  if (recorded !== undefined) {
    if (configId !== undefined && configId.toLowerCase() !== recorded.toLowerCase()) {
      throw recordedIdConflict(key, recorded, configId);
    }
    return recorded;
  }

  if (configId === undefined) return undefined;
  const owner = Object.entries(lock.appIds).find(
    ([, id]) => id.toLowerCase() === configId.toLowerCase(),
  )?.[0];
  if (owner !== undefined && owner !== key && fs.existsSync(path.join(lock.root, owner))) {
    throw claimedIdConflict(configPath, owner);
  }
  return configId;
}

/**
 * How a command may treat a config whose id is not yet recorded.
 *
 * - `write`: local runs that may record, adopt, or generate ids
 * - `read`: local read-only runs; a missing id is a warning
 * - `require`: CI; a missing id is an error, since a fresh id per run would
 *   make every run a separate application
 */
export type AppIdPlanMode = "write" | "read" | "require";

/** One config to resolve: its path and the id its module evaluates to. */
export type AppIdEntryInput = {
  configPath: string;
  configId: string | undefined;
};

/** The resolved id of one config and where it came from. */
export type AppIdEntry = {
  configPath: string;
  key: string;
  id: string | undefined;
  source: "lock" | "config" | "generated" | "none";
  /** The config still carries the id; remove it once the lock is written. */
  removeConfigId: boolean;
};

/** The `appIds` section after resolving a batch of configs. */
export type AppIdPlan = {
  appIds: Record<string, string>;
  /** Whether `appIds` differs from the lock it was planned against. */
  changed: boolean;
  /** One entry per input, in input order. */
  entries: AppIdEntry[];
};

export type PlanAppIdsParams = {
  lock: AppIdLock;
  entries: readonly AppIdEntryInput[];
  mode: AppIdPlanMode;
};

/**
 * The one error `resolveAppId` and `planAppIds` both raise when a config's
 * own id disagrees with the id its key already has recorded in the lock.
 * Shared so the two call sites cannot drift apart on wording or condition.
 * @param key - The config's lock key
 * @param recorded - The id already recorded for `key` in the lock
 * @param configId - The disagreeing id the config's module evaluates to
 * @returns The conflict error to throw
 */
function recordedIdConflict(key: string, recorded: string, configId: string): CLIError {
  return CLIError({
    code: "APP_ID_CONFLICT",
    message: `${TAILOR_LOCK_FILENAME} records app id "${recorded}" for ${key}, but the config's 'id' is "${configId}".`,
    suggestion:
      "Neither can be chosen automatically: remove the 'id' from the config to keep the recorded id, or replace the recorded value with the config's id.",
  });
}

/**
 * The one error `resolveAppId` and `planAppIds` both raise when a config's
 * own id is already recorded in the lock for a different config. Shared so
 * the two call sites cannot drift apart on wording or condition.
 * @param configPath - Absolute path to the config carrying the claimed id
 * @param owner - The lock key that already owns the id
 * @returns The conflict error to throw
 */
function claimedIdConflict(configPath: string, owner: string): CLIError {
  return CLIError({
    code: "APP_ID_CONFLICT",
    message: `${configPath} carries the app id already recorded for ${owner} in ${TAILOR_LOCK_FILENAME}.`,
    suggestion: "If this config was copied from that app, delete its 'id' so it gets a fresh one.",
  });
}

/**
 * The one error `resolveAppId` and `planAppIds` both raise when a config's
 * own id, not recorded anywhere yet, is not itself a UUID. Shared so the two
 * call sites cannot drift apart on wording or condition.
 * @param configPath - Absolute path to the config carrying the invalid id
 * @returns The validation error to throw
 */
function configIdInvalid(configPath: string): CLIError {
  return CLIError({
    code: "CONFIG_ID_INVALID",
    message: `'id' in ${configPath} must be a UUID.`,
    suggestion: "To use this config for a separate app, delete it.",
  });
}

function warnConfigStillCarriesId(key: string): void {
  logger.warn(
    `${key} still carries an 'id' that is also recorded in ${TAILOR_LOCK_FILENAME}. ` +
      "Remove it from the config, or run 'tailor deploy' locally to move it; " +
      "the lock is where the id lives now.",
  );
}

function warnUnrecordedConfigId(key: string): void {
  logger.warn(
    `The app id of ${key} is read from the config and not yet recorded in ${TAILOR_LOCK_FILENAME}. ` +
      `Run 'tailor deploy' locally and commit ${TAILOR_LOCK_FILENAME}.`,
  );
}

function warnMissingLockedAppId(key: string): void {
  logger.warn(`No app id is recorded for ${key} in ${TAILOR_LOCK_FILENAME}.`);
  logger.log(
    "  Resources tagged with an id from an earlier deploy read as another application's:\n" +
      "  deploy asks before taking them over, and remove leaves them in place. Only resources\n" +
      "  carrying no id are matched by application name. 'tailor deploy' records an id for you.",
  );
}

function rekeyInstructions(orphans: readonly string[]): string {
  return (
    `${TAILOR_LOCK_FILENAME} has entries whose config no longer exists: ${orphans.join(", ")}. ` +
    "If an app directory was moved, re-key its entry to the new path under 'appIds' so the " +
    "app keeps its id; delete the entries of removed apps."
  );
}

function missingInCIError(keys: readonly string[], orphans: readonly string[]): Error {
  let suggestion = `Run 'tailor deploy' locally and commit ${TAILOR_LOCK_FILENAME}.`;
  if (orphans.length > 0) suggestion += ` ${rekeyInstructions(orphans)}`;
  return CLIError({
    code: "CONFIG_ID_REQUIRED_IN_CI",
    message: `No app id is recorded for ${keys.join(", ")} in ${TAILOR_LOCK_FILENAME}, and the config has no 'id'.`,
    details:
      "CI does not generate one (each run would be treated as a separate app and break resource ownership).",
    suggestion,
  });
}

async function confirmMove(from: string, to: string): Promise<boolean> {
  if (!canPrompt()) {
    throw CLIError({
      code: "APP_ID_NOT_RECORDED",
      message: `No app id is recorded for ${to}.`,
      suggestion: rekeyInstructions([from]),
    });
  }
  logger.warn(
    `${TAILOR_LOCK_FILENAME} records an app id for ${from}, which no longer exists, ` +
      `and ${to} has none.`,
  );
  return prompt.confirm({
    message: `Was ${from} moved to ${to}? Yes keeps its app id; no assigns a fresh one.`,
    default: false,
  });
}

/**
 * Decide the app id of every config in a batch against one lock file.
 *
 * Precedence per config: the lock entry, then the id the config evaluates to,
 * then a generated id. A config whose id disagrees with its lock entry is an
 * error, since neither value can be chosen mechanically. Reads nothing but the
 * lock passed in and the existence of the files its entries name; the caller
 * persists the returned `appIds`.
 * @param params - The lock, the configs to resolve, and the mode
 * @returns The resolved entries and the `appIds` section to persist
 */
export async function planAppIds(params: PlanAppIdsParams): Promise<AppIdPlan> {
  const { lock, entries, mode } = params;
  const appIds: Record<string, string> = { ...lock.appIds };
  let changed = false;
  const planned: Array<AppIdEntry | undefined> = entries.map(() => undefined);
  const unresolved: Array<{ index: number; configPath: string; key: string }> = [];
  // Every id in play, recorded or provisional, so two configs can never leave
  // this plan sharing one even when nothing is persisted.
  const claimed = new Map<string, string>(
    Object.entries(appIds).map(([key, id]) => [id.toLowerCase(), key]),
  );
  const exists = (key: string): boolean => fs.existsSync(path.join(lock.root, key));

  entries.forEach(({ configPath, configId }, index) => {
    const key = appIdLockKey(lock.root, configPath);
    const recorded = appIds[key];
    if (recorded !== undefined) {
      if (configId !== undefined && configId.toLowerCase() !== recorded.toLowerCase()) {
        throw recordedIdConflict(key, recorded, configId);
      }
      const removeConfigId = configId !== undefined && mode === "write";
      if (configId !== undefined && !removeConfigId) warnConfigStillCarriesId(key);
      planned[index] = { configPath, key, id: recorded, source: "lock", removeConfigId };
      return;
    }
    if (configId !== undefined) {
      if (!uuidRegex.test(configId)) {
        throw configIdInvalid(configPath);
      }
      const owner = claimed.get(configId.toLowerCase());
      const movedFrom = owner !== undefined && owner !== key && !exists(owner) ? owner : undefined;
      if (owner !== undefined && owner !== key && movedFrom === undefined) {
        throw claimedIdConflict(configPath, owner);
      }
      claimed.set(configId.toLowerCase(), key);
      const removeConfigId = mode === "write";
      if (removeConfigId) {
        if (movedFrom !== undefined) {
          delete appIds[movedFrom];
          logger.info(`Keeping the app id of ${movedFrom} for ${key}: ${configId}`);
        }
        appIds[key] = configId;
        changed = true;
      } else {
        warnUnrecordedConfigId(key);
      }
      planned[index] = { configPath, key, id: configId, source: "config", removeConfigId };
      return;
    }
    unresolved.push({ index, configPath, key });
  });

  const finish = (): AppIdPlan => ({
    appIds,
    changed,
    entries: planned.map((entry) => assertDefined(entry, "app id entry missing")),
  });
  if (unresolved.length === 0) return finish();
  if (mode === "read") {
    for (const { index, configPath, key } of unresolved) {
      warnMissingLockedAppId(key);
      planned[index] = { configPath, key, id: undefined, source: "none", removeConfigId: false };
    }
    return finish();
  }

  const orphans = Object.keys(appIds).filter((key) => !exists(key));
  const keys = [...new Set(unresolved.map(({ key }) => key))];
  if (mode === "require") throw missingInCIError(keys, orphans);

  let moved: { from: string; key: string } | undefined;
  if (orphans.length === 1 && keys.length === 1) {
    const from = assertDefined(orphans[0], "orphan missing");
    const key = assertDefined(keys[0], "key missing");
    if (await confirmMove(from, key)) moved = { from, key };
  } else if (orphans.length > 0) {
    throw CLIError({
      code: "APP_ID_NOT_RECORDED",
      message: `No app id is recorded for ${keys.join(", ")}.`,
      suggestion: rekeyInstructions(orphans),
    });
  }

  for (const { index, configPath, key } of unresolved) {
    const alreadyPlanned = appIds[key];
    if (alreadyPlanned !== undefined) {
      planned[index] = {
        configPath,
        key,
        id: alreadyPlanned,
        source: "generated",
        removeConfigId: false,
      };
      continue;
    }
    let id: string;
    if (moved?.key === key) {
      id = assertDefined(appIds[moved.from], "orphaned app id missing");
      delete appIds[moved.from];
      logger.info(`Keeping the app id of ${moved.from} for ${key}: ${id}`);
    } else {
      id = crypto.randomUUID();
      logger.info(`Generated app id for ${key}: ${id}`);
    }
    appIds[key] = id;
    changed = true;
    const source = moved?.key === key ? "lock" : "generated";
    planned[index] = { configPath, key, id, source, removeConfigId: false };
  }
  return finish();
}

export type WriteAppIdsParams = {
  lock: AppIdLock;
  appIds: AppIds;
};

/**
 * Write a planned `appIds` section into an existing lock file, leaving every
 * other field as it is. Only the entries the plan changed relative to the lock
 * it was planned against are applied, so a deploy of another app that wrote
 * the file in the meantime keeps its entry. Only `tailor setup` creates the
 * lock, so a missing file is an error rather than a reason to create one.
 * @param params - The lock the plan was made against and the planned section
 */
export function writeAppIds(params: WriteAppIdsParams): void {
  const { lock, appIds } = params;
  const raw = readRawLock(lock.root);
  if (raw === null) {
    throw CLIError({
      code: "APP_ID_LOCK_NOT_FOUND",
      message: `${TAILOR_LOCK_FILENAME} does not exist under ${lock.root}.`,
      suggestion: "Create it with 'tailor setup'.",
    });
  }
  const merged: Record<string, string> = { ...parseAppIds(raw.appIds) };
  for (const key of Object.keys(lock.appIds)) {
    if (!(key in appIds)) delete merged[key];
  }
  for (const [key, id] of Object.entries(appIds)) {
    if (lock.appIds[key] !== id) merged[key] = id;
  }
  const next = { ...raw, version: TAILOR_LOCK_VERSION, appIds: merged };
  fs.writeFileSync(
    path.join(lock.root, TAILOR_LOCK_FILENAME),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf-8",
  );
}

/** Result of {@link removeAdoptedConfigIds}. */
export type RemoveAdoptedConfigIdsResult = {
  /** Whether at least one config file was edited. */
  configEdited: boolean;
};

/**
 * Remove the `id` from every config whose id the plan moved into the lock.
 * Call it after the lock has been written, so the id is never held nowhere.
 * A config shape that cannot be edited is reported with a manual-edit hint.
 * @param plan - A plan produced in `write` mode
 * @returns Whether any config was edited
 */
export async function removeAdoptedConfigIds(
  plan: AppIdPlan,
): Promise<RemoveAdoptedConfigIdsResult> {
  let configEdited = false;
  const edited = new Set<string>();
  for (const entry of plan.entries) {
    if (!entry.removeConfigId || entry.id === undefined || edited.has(entry.configPath)) continue;
    edited.add(entry.configPath);
    if (await removeConfigId(entry.configPath, entry.id)) {
      configEdited = true;
      logger.info(`Moved the app id of ${entry.key} from the config into ${TAILOR_LOCK_FILENAME}.`);
    } else {
      logger.warn(
        `The app id of ${entry.key} is recorded in ${TAILOR_LOCK_FILENAME}. Remove the 'id' from ` +
          "the object passed to defineConfig() by hand; the SDK could not edit " +
          `${entry.configPath} to do it.`,
      );
    }
  }
  return { configEdited };
}

/**
 * Resolve the app ids of a batch of configs against their lock, and in `write`
 * mode persist the outcome: the lock first, then the config edits.
 * @param params - The lock, the configs to resolve, and the mode
 * @returns The plan, whose entries carry the id of every config in input order
 */
export async function resolveLockedAppIds(params: PlanAppIdsParams): Promise<AppIdPlan> {
  const plan = await planAppIds(params);
  if (params.mode === "write") {
    if (plan.changed) writeAppIds({ lock: params.lock, appIds: plan.appIds });
    await removeAdoptedConfigIds(plan);
  }
  return plan;
}

/**
 * The plan mode for a deploy run: CI requires a recorded id unless
 * `TAILOR_CI_ALLOW_ID_INJECTION=true` opts into local behavior; local runs
 * write on a real deploy and only read on a dry-run.
 * @param dryRun - Whether this is a dry-run
 * @returns The mode to plan with
 */
export function appIdPlanModeForDeploy(dryRun: boolean): AppIdPlanMode {
  const allowCIInjection = parseBoolean(process.env.TAILOR_CI_ALLOW_ID_INJECTION) === true;
  if (isCI && !allowCIInjection) return "require";
  return dryRun ? "read" : "write";
}
