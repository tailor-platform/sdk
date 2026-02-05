/**
 * Type definitions for change-history plugin.
 */

import type { TailorAnyDBType } from "@/configure/services/tailordb";

/**
 * Context passed to change-history plugin executors.
 * Contains type references and namespace for data operations.
 */
export interface ChangeHistoryContext {
  /** The source TailorDB type that the plugin is attached to */
  sourceType: TailorAnyDBType;
  /** The generated History type for storing change records */
  historyType: TailorAnyDBType;
  /** TailorDB namespace for database operations */
  namespace: string;
  /** Index signature for compatibility with PluginExecutorContext */
  [key: string]: TailorAnyDBType | string;
}

/**
 * Generated type kinds for change-history plugin.
 */
export type GeneratedTypeKind = "history";

/**
 * Action type for change history
 */
export type ChangeHistoryAction = "CREATE" | "UPDATE" | "DELETE";

/**
 * Raw change history record as stored in the database
 */
export interface ChangeHistoryRecord {
  /** Unique identifier for this history entry */
  id: string;
  /** ID of the record that was changed */
  recordId: string;
  /** The action that was performed */
  action: ChangeHistoryAction;
  /** User ID who performed the action (null for system actions) */
  performedBy: string | null;
  /** When the action was performed */
  performedAt: Date;
  /** JSON string of the record state before the change */
  previousValues: string | null;
  /** JSON string of the record state after the change */
  newValues: string | null;
  /** JSON string array of field names that changed */
  changedFields: string | null;
  /** When this history entry was created */
  createdAt: Date;
  /** When this history entry was last updated */
  updatedAt: Date | null;
}

/**
 * Parsed change history with typed values
 */
export interface ParsedChangeHistory<T = Record<string, unknown>> {
  /** Unique identifier for this history entry */
  id: string;
  /** ID of the record that was changed */
  recordId: string;
  /** The action that was performed */
  action: ChangeHistoryAction;
  /** User ID who performed the action (null for system actions) */
  performedBy: string | null;
  /** When the action was performed */
  performedAt: Date;
  /** Parsed previous record state */
  previousValues: T | null;
  /** Parsed new record state */
  newValues: T | null;
  /** Array of field names that changed */
  changedFields: string[] | null;
  /** When this history entry was created */
  createdAt: Date;
  /** When this history entry was last updated */
  updatedAt: Date | null;
}

/**
 * Parse a change history record to get typed values.
 * Converts JSON string fields to their proper types.
 * @param record - The raw change history record from the database
 * @returns Parsed change history with typed values
 * @example
 * ```typescript
 * const history = await db.selectFrom("UserHistory").selectAll().execute();
 * const parsed = history.map(parseChangeHistory<User>);
 * // parsed[0].newValues is now typed as User | null
 * ```
 */
export function parseChangeHistory<T = Record<string, unknown>>(
  record: ChangeHistoryRecord,
): ParsedChangeHistory<T> {
  return {
    ...record,
    previousValues: record.previousValues ? (JSON.parse(record.previousValues) as T) : null,
    newValues: record.newValues ? (JSON.parse(record.newValues) as T) : null,
    changedFields: record.changedFields ? (JSON.parse(record.changedFields) as string[]) : null,
  };
}
