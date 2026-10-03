import { logger } from "./logger";
import type { Jsonifiable } from "type-fest";

/**
 * Result of a command that changes state. `changed` is false when the command finished without
 * changing anything, for example because the requested state was already in place.
 */
export type MutationResult = { changed: boolean } & { [key: string]: Jsonifiable };

/**
 * Print a state-changing command's result on stdout under JSON output. Without JSON output the
 * command's stderr summary already reports the outcome, so nothing is printed.
 * @param result - Result to print
 */
export function printMutationResult(result: MutationResult): void {
  if (logger.jsonMode) logger.out(result);
}
