import { logger } from "./logger";

/**
 * Warn that a feature is in beta.
 * @param {string} featureName - Name of the beta feature (e.g., "tailordb erd", "tailordb migration")
 */
export function logBetaWarning(featureName: string): void {
  logger.warn(
    `The '${featureName}' command is a beta feature and may introduce breaking changes in future releases.`,
  );
  logger.newline();
}
