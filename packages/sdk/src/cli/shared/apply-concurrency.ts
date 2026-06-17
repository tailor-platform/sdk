import pLimit from "p-limit";

/**
 * Default cap on concurrent operator RPCs when `TAILOR_APPLY_CONCURRENCY` is
 * unset. Chosen to tame the create burst (a fresh workspace fires one
 * `create*` per resource at once) that triggers the platform-side
 * `already_exists` race on compound creates, while still deploying quickly.
 */
const DEFAULT_APPLY_CONCURRENCY = 16;

/**
 * Resolve the maximum number of operator RPCs to run in parallel.
 *
 * Resolution order:
 * 1. `TAILOR_APPLY_CONCURRENCY` env var (positive integer)
 * 2. `DEFAULT_APPLY_CONCURRENCY`
 *
 * A fresh-workspace apply creates every resource at once; firing all of them
 * concurrently overloads the platform, whose responses then come back as
 * `Unavailable`/`ResourceExhausted` and drive retries into the non-idempotent
 * compound-create `already_exists` race. Capping bounds the worst case.
 * @returns Concurrency cap (always >= 1)
 */
export function resolveApplyConcurrency(): number {
  const envValue = process.env.TAILOR_APPLY_CONCURRENCY;
  if (envValue !== undefined) {
    const trimmed = envValue.trim();
    if (trimmed !== "" && /^[1-9]\d*$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }
  }
  return DEFAULT_APPLY_CONCURRENCY;
}

/**
 * Create a limiter capped at the resolved apply concurrency. The returned
 * function defers a task until a slot is free, then resolves with its result.
 *
 * Share a single instance across all RPCs that should contend for the same
 * budget (e.g. one per operator client) so the cap bounds total in-flight
 * calls, not per-call-site bursts.
 * @returns A limiter that defers tasks beyond the concurrency cap
 */
export function createApplyLimiter(): <R>(task: () => Promise<R>) => Promise<R> {
  return pLimit(resolveApplyConcurrency());
}

/**
 * Comparator that orders `name`-bearing items by `name`, for a stable,
 * reproducible apply order within the concurrency cap.
 *
 * Uses a code-point comparison rather than `localeCompare` so the order does
 * not depend on the runtime's default locale/collation.
 * @param a - Left item
 * @param b - Right item
 * @returns Negative, zero, or positive per code-point ordering of the names
 */
export function byName(a: { name: string }, b: { name: string }): number {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}
