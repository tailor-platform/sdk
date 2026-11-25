import { isRetryableWaitError } from "#/cli/shared/wait-error";

export interface PollUntilParams<T> {
  /** Wait between reads in milliseconds */
  pollInterval: number;
  /** Epoch milliseconds after which polling stops; none when it is unlimited */
  deadline: number | undefined;
  /** One read. Resolves to the result that ends polling, or to undefined to read again. */
  read: (signal: AbortSignal | undefined) => Promise<T | undefined>;
  /** Result when the deadline passed before a read (`deadline`) or while one was running (`read`) */
  onTimeout: (stage: "deadline" | "read") => T;
  /** Result for a failure that is not retryable */
  onError: (error: unknown) => T;
}

/**
 * Read repeatedly until a read settles, the deadline passes, or a read fails for good.
 * @param params - What to read and how long to keep reading
 * @returns What ended polling
 */
export async function pollUntil<T>(params: PollUntilParams<T>): Promise<T> {
  const { pollInterval, deadline } = params;
  // loop exits when a read settles, the deadline passes, or a read fails for good
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    let signal: AbortSignal | undefined;
    try {
      if (deadline !== undefined) {
        const budget = deadline - Date.now();
        if (budget <= 0) return params.onTimeout("deadline");
        signal = AbortSignal.timeout(budget);
      }
      const settled = await params.read(signal);
      if (settled !== undefined) return settled;
    } catch (error) {
      // The signal fires on the deadline, but its timer can run a few milliseconds ahead of the clock.
      if (signal?.aborted) return params.onTimeout("read");
      if (!isRetryableWaitError(error)) return params.onError(error);
    }
    const remaining = deadline === undefined ? pollInterval : deadline - Date.now();
    if (remaining <= 0) return params.onTimeout("deadline");
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollInterval, remaining)));
  }
}
