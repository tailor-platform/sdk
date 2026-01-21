/**
 * Types for TailorDB migration execution
 */

import { formatMigrationNumber } from "./snapshot";
import type { MigrationDiff } from "./diff-calculator";

// ============================================================================
// Label Constants
// ============================================================================

/**
 * Maximum length for Kubernetes label values
 * Labels must match pattern: ^[a-z][a-z0-9_-]{0,62}
 */
export const MAX_LABEL_LENGTH = 63;

/**
 * Prefix added to migration numbers in labels (required because migration names start with numbers)
 */
export const MIGRATION_LABEL_PREFIX = "m";

/**
 * Label key for storing migration state in TailorDB Service metadata
 */
export const MIGRATION_LABEL_KEY = "sdk-migration";

// ============================================================================
// Error Constants
// ============================================================================

/**
 * Error patterns that indicate schema corruption
 */
export const SCHEMA_ERROR_PATTERNS = [
  "failed to fetch schema",
  "sqlaccess error",
  "schema not found",
  "invalid schema",
] as const;

// ============================================================================
// Types
// ============================================================================

/**
 * Pending migration to be executed
 */
export interface PendingMigration {
  /** Migration number */
  number: number;
  /** Path to migration script file */
  scriptPath: string;
  /** Path to diff file */
  diffPath: string;
  /** Namespace this migration belongs to */
  namespace: string;
  /** Migrations directory path */
  migrationsDir: string;
  /** Migration diff content */
  diff: MigrationDiff;
}

// ============================================================================
// Label Helper Functions
// ============================================================================

/**
 * Sanitize migration number for use as label value
 * Label pattern: ^[a-z][a-z0-9_-]{0,62}
 * - Must start with lowercase letter (add prefix since migration numbers start with digits)
 * - Max 63 characters
 * @param {number} migrationNumber - Migration number to sanitize
 * @returns {string} Sanitized label value
 */
export function sanitizeMigrationLabel(migrationNumber: number): string {
  const sanitized = MIGRATION_LABEL_PREFIX + formatMigrationNumber(migrationNumber);
  return sanitized.slice(0, MAX_LABEL_LENGTH);
}

/**
 * Parse migration number from label value
 * @param {string} label - Label value (e.g., "m0001")
 * @returns {number | null} Parsed number or null if invalid
 */
export function parseMigrationLabelNumber(label: string): number | null {
  if (!label.startsWith(MIGRATION_LABEL_PREFIX)) return null;
  const numStr = label.slice(MIGRATION_LABEL_PREFIX.length);
  const num = parseInt(numStr, 10);
  return isNaN(num) ? null : num;
}

// ============================================================================
// Error Helper Functions
// ============================================================================

/**
 * Check if an error message indicates schema corruption
 * @param {string} errorMessage - Error message to check
 * @returns {boolean} True if error indicates schema corruption
 */
export function isSchemaError(errorMessage: string): boolean {
  const lowerMessage = errorMessage.toLowerCase();
  return SCHEMA_ERROR_PATTERNS.some((pattern) => lowerMessage.includes(pattern));
}
