import type { TailorAnyDBField, TailorDBField } from "@/types/tailor-db-field";
import type { GqlOperationsConfig } from "@/types/tailordb";
import type { TailorUser } from "@/types/user";

// --- Hook types (UX-focused, for configure layer) ---

/**
 * Record-level hook function arguments.
 * `data` is the full record snapshot at hook time.
 */
type RecordHookFnArgs<TData> = {
  readonly data: Readonly<TData>;
  readonly user: TailorUser;
};

/**
 * Record-level hook function.
 * Receives the entire record `data` and must return an object containing
 * only the fields to override on the record. Unchanged fields can be omitted.
 */
type RecordHookFn<TData> = (args: RecordHookFnArgs<TData>) => Partial<TData>;

/**
 * Record-level hooks for create/update operations.
 * Each callback receives `{ data, user }` and returns an object with only the
 * fields to override; omitted fields keep their incoming values.
 */
export type RecordHook<TData> = {
  create?: RecordHookFn<TData>;
  update?: RecordHookFn<TData>;
};

// --- Field helper types ---

export type ExcludeNestedDBFields<T extends Record<string, TailorAnyDBField>> = {
  // Nested types depend on generic output; exclude them via a loose match.
  // oxlint-disable-next-line no-explicit-any
  [K in keyof T]: T[K] extends TailorDBField<{ type: "nested"; array: boolean }, any>
    ? never
    : T[K];
};

// --- Type features ---

export interface TypeFeatures {
  pluralForm?: string;
  aggregation?: true;
  bulkUpsert?: true;
  /** Configure GraphQL operations for this type. Use "query" for read-only mode, or an object for granular control. */
  gqlOperations?: GqlOperationsConfig;
  /**
   * Enable publishing events for this type.
   * When enabled, record creation/update/deletion events are published.
   * If not specified, this is automatically set to true when an executor uses this type
   * with recordCreated/recordUpdated/recordDeleted triggers. If explicitly set to false
   * while an executor uses this type, an error will be thrown during apply.
   */
  publishEvents?: boolean;
}
