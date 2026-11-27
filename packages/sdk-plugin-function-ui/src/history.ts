export const HISTORY_LIMIT = 100;

/**
 * Add the newest entry at the front and drop the oldest ones past the limit.
 * @param entries - The entries so far, newest first
 * @param next - The entry that arrived
 * @param limit - How many entries to keep
 * @returns The new list
 */
export function prependEntry<T>(entries: readonly T[], next: T, limit: number): T[] {
  return [next, ...entries].slice(0, limit);
}
