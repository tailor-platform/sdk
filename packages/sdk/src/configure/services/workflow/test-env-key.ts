/**
 * Typed accessors for the test-time globalThis slot used to pass `env` from
 * `mockWorkflow().setEnv()` (in `@tailor-platform/sdk/vitest`) to
 * `createWorkflowJob().trigger()` bodies. The slot key is private to this
 * module; callers go through the get/set/clear functions below so both sides
 * share the same access path.
 *
 * Lives in its own file (with no `@/` imports) so `vitest/mock.ts` can load
 * it from nested Vitest configs that do not resolve `@/` aliases.
 * @internal
 */
import type { TailorEnv } from "../../../types/env";
import type { TailorPrincipal } from "../../../types/user";

const SLOT_KEY = "__tailorWorkflowTestEnv";
const INVOKER_SLOT_KEY = "__tailorWorkflowTestInvoker";

/**
 * Read the test-time env slot.
 * @returns Current env, or `undefined` when unset.
 * @internal
 */
export function readWorkflowTestEnv(): TailorEnv | undefined {
  return (globalThis as unknown as Record<string, TailorEnv | undefined>)[SLOT_KEY];
}

/**
 * Write the test-time env slot.
 * @param env - Env value to expose to `.trigger()` bodies.
 * @internal
 */
export function writeWorkflowTestEnv(env: TailorEnv): void {
  (globalThis as unknown as Record<string, TailorEnv>)[SLOT_KEY] = env;
}

/**
 * Clear the test-time env slot.
 * @internal
 */
export function clearWorkflowTestEnv(): void {
  delete (globalThis as unknown as Record<string, unknown>)[SLOT_KEY];
}

function invokerSlot(): { hasValue: boolean; value: TailorPrincipal | null | undefined } {
  const slots = globalThis as unknown as Record<string, TailorPrincipal | null | undefined>;
  return {
    hasValue: Object.hasOwn(slots, INVOKER_SLOT_KEY),
    value: slots[INVOKER_SLOT_KEY],
  };
}

function writeWorkflowTestInvoker(invoker: TailorPrincipal | null): void {
  (globalThis as unknown as Record<string, TailorPrincipal | null>)[INVOKER_SLOT_KEY] = invoker;
}

function restoreWorkflowTestInvoker(previous: {
  hasValue: boolean;
  value: TailorPrincipal | null | undefined;
}): void {
  const slots = globalThis as unknown as Record<string, TailorPrincipal | null | undefined>;
  if (previous.hasValue) {
    slots[INVOKER_SLOT_KEY] = previous.value;
  } else {
    delete slots[INVOKER_SLOT_KEY];
  }
}

export function withWorkflowTestInvoker<T>(invoker: TailorPrincipal | null, run: () => T): T {
  const previous = invokerSlot();
  writeWorkflowTestInvoker(invoker);
  try {
    const result = run();
    if (result instanceof Promise) {
      return result.finally(() => restoreWorkflowTestInvoker(previous)) as T;
    }
    restoreWorkflowTestInvoker(previous);
    return result;
  } catch (cause) {
    restoreWorkflowTestInvoker(previous);
    throw cause;
  }
}

/**
 * Env-var fallback read by `.trigger()` when `mockWorkflow().setEnv()` is unset.
 * @deprecated Use `mockWorkflow().setEnv()` from `@tailor-platform/sdk/vitest`.
 * @internal
 */
export const WORKFLOW_TEST_ENV_KEY = "TAILOR_TEST_WORKFLOW_ENV";

type RuntimeInvoker = {
  id: string;
  type: "user" | "machine_user";
  workspaceId: string;
  attributes?: string[] | TailorPrincipal["attributes"];
  attributeMap?: TailorPrincipal["attributes"];
  attributeList?: TailorPrincipal["attributeList"];
};

function readRuntimeInvoker(): TailorPrincipal | null {
  const runtime = (
    globalThis as unknown as {
      tailor?: { context?: { getInvoker?: () => RuntimeInvoker | null } };
    }
  ).tailor?.context?.getInvoker;
  const raw = runtime?.();
  if (!raw) return null;
  return {
    id: raw.id,
    type: raw.type,
    workspaceId: raw.workspaceId,
    attributes: raw.attributeMap ?? (Array.isArray(raw.attributes) ? {} : (raw.attributes ?? {})),
    attributeList: (raw.attributeList ??
      (Array.isArray(raw.attributes) ? raw.attributes : [])) as TailorPrincipal["attributeList"],
  };
}

// env from `mockWorkflow().setEnv()`, else the deprecated env-var. Shallow-copied
// to isolate against cross-trigger mutation.
export function buildJobContext(): { env: TailorEnv; invoker: TailorPrincipal | null } {
  const currentInvoker = invokerSlot();
  const invoker = currentInvoker.hasValue ? (currentInvoker.value ?? null) : readRuntimeInvoker();
  const fromGlobal = readWorkflowTestEnv();
  if (fromGlobal !== undefined) return { env: { ...fromGlobal }, invoker };
  const raw = process.env[WORKFLOW_TEST_ENV_KEY];
  if (!raw) return { env: {} as TailorEnv, invoker };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `Invalid JSON in ${WORKFLOW_TEST_ENV_KEY}; provide valid JSON or use mockWorkflow().setEnv().`,
      { cause },
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `${WORKFLOW_TEST_ENV_KEY} must be a JSON object; provide a record or use mockWorkflow().setEnv().`,
    );
  }
  return { env: { ...(parsed as TailorEnv) }, invoker };
}
