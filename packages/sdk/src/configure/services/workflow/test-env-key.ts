/**
 * Typed accessors for the test-time globalThis slot used to pass `env` from
 * `mockWorkflow.setEnv()` (in `@tailor-platform/sdk/vitest`) to
 * `createWorkflowJob().trigger()` bodies. The slot key is private to this
 * module; callers go through the get/set/clear functions below so both sides
 * share the same access path.
 *
 * Lives in its own file (with no `@/` imports) so `vitest/mock.ts` can load
 * it from nested Vitest configs that do not resolve `@/` aliases.
 * @internal
 */
import type { TailorEnv } from "../../../types/env";

const SLOT_KEY = "__tailorWorkflowTestEnv";

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

/**
 * Env-var fallback read by `.trigger()` when `mockWorkflow().setEnv()` is unset.
 * @deprecated Use `mockWorkflow().setEnv()` from `@tailor-platform/sdk/vitest`.
 * @internal
 */
export const WORKFLOW_TEST_ENV_KEY = "TAILOR_TEST_WORKFLOW_ENV";

/**
 * Build the context passed to a registered job body run locally by `.trigger()`:
 * `mockWorkflow().setEnv()` when set, else the deprecated env-var (failing fast on
 * malformed JSON). Shallow-copied to isolate against cross-trigger mutation.
 * @returns Job context with `env` and a `null` invoker.
 * @internal
 */
export function buildJobContext(): { env: TailorEnv; invoker: null } {
  const fromGlobal = readWorkflowTestEnv();
  if (fromGlobal !== undefined) return { env: { ...fromGlobal }, invoker: null };
  const raw = process.env[WORKFLOW_TEST_ENV_KEY];
  if (!raw) return { env: {} as TailorEnv, invoker: null };
  try {
    return { env: JSON.parse(raw) as TailorEnv, invoker: null };
  } catch (cause) {
    throw new Error(
      `Invalid JSON in ${WORKFLOW_TEST_ENV_KEY}; provide valid JSON or use mockWorkflow().setEnv().`,
      { cause },
    );
  }
}
