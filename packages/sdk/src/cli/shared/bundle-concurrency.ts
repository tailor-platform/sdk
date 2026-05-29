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
 * @param items - Items to process
 * @param worker - Async worker function
 * @returns Worker results in input order
 */
export function withBundleConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const limit = pLimit(resolveBundleConcurrency());
  return Promise.all(items.map((item) => limit(() => worker(item))));
}
