import { logger } from "./logger";

/** Items fetched under a `--limit`, and whether more were available. */
export interface LimitedItems<T> {
  items: T[];
  truncated: boolean;
}

/**
 * Fetch up to `limit` items and learn whether more exist, by asking for one more than the limit.
 * @param limit - Maximum number of items; 0 or undefined fetches every item
 * @param fetch - Fetches up to the given number of items (0 or undefined: every item)
 * @returns The items within the limit, and whether more were available
 */
export async function fetchWithinLimit<T>(
  limit: number | undefined,
  fetch: (limit: number | undefined) => Promise<T[]>,
): Promise<LimitedItems<T>> {
  if (!limit) return { items: await fetch(limit), truncated: false };
  const items = await fetch(limit + 1);
  if (items.length <= limit) return { items, truncated: false };
  return { items: items.slice(0, limit), truncated: true };
}

/**
 * Tell the caller that `--limit` cut the output short. Call it after printing the items so the
 * notice follows them.
 * @param result - Items returned by {@link fetchWithinLimit}
 * @param limit - The `--limit` in effect
 */
export function reportTruncation(result: LimitedItems<unknown>, limit: number | undefined): void {
  if (!result.truncated) return;
  logger.info(`More results exist beyond --limit ${limit}. Raise --limit to see more.`);
}
