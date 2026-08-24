import * as os from "node:os";
import pLimit from "p-limit";

/**
 * Resolve the maximum number of bundle operations to run in parallel.
 *
 * Resolution order:
 * 1. `TAILOR_BUNDLE_CONCURRENCY` env var (positive integer)
 * 2. `os.cpus().length`, clamped to at least 1
 *
 * Each `rolldown.build` invocation drives its own module graph and Rust thread
 * pool, so unbounded parallelism can exhaust native memory on constrained
 * runners (e.g. ubuntu-latest GitHub Actions runners with hundreds of
 * resolvers). Capping at CPU count keeps the worst case predictable.
 * @returns Concurrency cap (always >= 1)
 */
export function resolveBundleConcurrency(): number {
  const envValue = process.env.TAILOR_BUNDLE_CONCURRENCY;
  if (envValue !== undefined) {
    const trimmed = envValue.trim();
    if (trimmed !== "" && /^[1-9]\d*$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }
  }
  return Math.max(1, os.cpus().length);
}

/**
 * Run an async worker over each item with the bundle-concurrency cap applied.
 * Results are returned in the same order as the input items.
 *
 * On the first rejection no further queued work starts, but already-running
 * workers are awaited before that first rejection is rethrown, so a failing
 * bundle cannot leave sibling builds writing output after the caller
 * has moved on.
 * @param items - Items to process
 * @param worker - Async worker function
 * @returns Worker results in input order
 */
export async function withBundleConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  results.length = items.length;
  const limit = pLimit(resolveBundleConcurrency());
  let rejection: { reason: unknown } | undefined;

  await Promise.all(
    // flatMap skips sparse slots and, unlike map, emits no slot for them either.
    items.flatMap((item, index) => [
      limit(async () => {
        if (rejection) return;
        try {
          results[index] = await worker(item);
        } catch (reason) {
          rejection ??= { reason };
        }
      }),
    ]),
  );

  if (rejection) {
    throw rejection.reason;
  }
  return results;
}
