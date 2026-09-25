/**
 * The wait point key grammar shared by declaration-time validation
 * (parser) and runtime key composition (configure). Both sides must
 * accept exactly the same keys, so the rules live here once.
 */
export const WAIT_POINT_KEY_REGEX = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
export const WAIT_POINT_KEY_MAX_LENGTH = 63;
export const WAIT_POINT_KEY_GRAMMAR =
  "[a-z0-9-] (3-63 characters; must start and end with [a-z0-9])";

/**
 * Whether a `-`-separated key segment names a `$param`.
 * A bare "$" names nothing, so it is not a param on either side.
 * @param segment - One segment of a wait point key
 * @returns True when the segment is a `$param` reference
 */
export function isWaitPointParamSegment(segment: string): boolean {
  return segment.startsWith("$") && segment.length > 1;
}
