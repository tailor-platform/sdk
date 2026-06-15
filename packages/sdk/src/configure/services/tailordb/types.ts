import type { output } from "@/types/helpers";
import type { TailorAnyDBField, TailorDBField } from "@/types/tailor-db-field";
import type { GqlOperationsConfig } from "@/types/tailordb";
import type { TailorPrincipal } from "@/types/user";
import type { NonEmptyObject } from "type-fest";

// --- Hook types (UX-focused, for configure layer) ---

type HookFn<TValue, TData, TReturn> = (args: {
  value: TValue;
  data: TData extends Record<string, unknown>
    ? { readonly [K in keyof TData]?: TData[K] | null | undefined }
    : unknown;
  invoker: TailorPrincipal | null;
}) => TReturn;

export type Hook<TData, TReturn> = {
  create?: HookFn<TReturn | null, TData, TReturn>;
  update?: HookFn<TReturn | null, TData, TReturn>;
};

export type Hooks<
  F extends Record<string, TailorAnyDBField>,
  TData = { [K in keyof F]: output<F[K]> },
> = NonEmptyObject<{
  [K in Exclude<keyof F, "id"> as F[K]["_defined"] extends {
    hooks: unknown;
  }
    ? never
    : F[K]["_defined"] extends { type: "nested" }
      ? never
      : K]?: Hook<TData, output<F[K]>>;
}>;

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
