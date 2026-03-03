import { setTimeout } from "node:timers/promises";

/**
 * Create a simple progress reporter that writes updates to stderr.
 * @param label - Label to prefix progress output
 * @param total - Total number of steps
 * @returns Progress helpers
 */
export function createProgress(label: string, total: number) {
  let current = 0;

  const update = () => {
    current += 1;
    const percent = Math.round((current / total) * 100);
    process.stderr.write(`\r${label} ${current}/${total} (${percent}%)`);
  };

  const finish = () => {
    process.stderr.write("\n");
  };

  return { update, finish };
}

/**
 * Wrap a promise with a timeout, rejecting if the timeout elapses first.
 * @template T
 * @param p - Promise to await
 * @param ms - Timeout in milliseconds
 * @param message - Error message on timeout
 * @returns Result of the original promise if it completes in time
 */
export async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return await Promise.race([
    p,
    setTimeout(ms).then(() => {
      throw new Error(message);
    }),
  ]);
}
