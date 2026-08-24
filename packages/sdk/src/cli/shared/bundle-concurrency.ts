import * as os from "node:os";
import { parsePositiveInt } from "./parse-positive-int";

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
  return parsePositiveInt(process.env.TAILOR_BUNDLE_CONCURRENCY) ?? Math.max(1, os.cpus().length);
}

/**
 * Run an async worker over each item with the bundle-concurrency cap applied.
 * Results are returned in the same order as the input items.
 * @param items - Items to process
 * @param worker - Async worker function
 * @returns Worker results in input order
 */
export async function withBundleConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const resultCount = items.length;
  const workItems = items.flatMap((item, index) => [{ index, item }]);
  const results: R[] = [];
  results.length = resultCount;
  let nextWorkIndex = 0;
  let rejection: { reason: unknown } | undefined;

  const runWorker = async () => {
    while (!rejection) {
      const workItem = workItems[nextWorkIndex++];
      if (workItem === undefined) {
        return;
      }

      try {
        results[workItem.index] = await worker(workItem.item);
      } catch (reason) {
        rejection ??= { reason };
      }
    }
  };

  const workerCount = Math.min(resolveBundleConcurrency(), workItems.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));

  if (rejection) {
    throw rejection.reason;
  }
  return results;
}
