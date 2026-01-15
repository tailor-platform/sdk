import { logger } from "../../utils/logger";

/**
 * Warn that the ERD CLI is a beta feature.
 */
export function logErdBetaWarning(): void {
  logger.warn(
    "The ERD command is a beta feature and may introduce breaking changes in future releases.",
  );
}
