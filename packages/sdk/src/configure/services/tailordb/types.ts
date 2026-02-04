import { type TailorUser } from "@/configure/types";
import { type output, type Prettify } from "@/configure/types/helpers";
import { type DefinedFieldMetadata, type FieldMetadata } from "@/configure/types/types";
import { type TailorAnyDBField, type TailorDBField } from "./schema";
export type {
  TailorDBExternalConfig,
  TailorDBMigrationConfig,
  TailorDBServiceConfig,
  TailorDBServiceInput,
} from "@/parser/service/tailordb/types";
import type { NonEmptyObject } from "type-fest";

export type SerialConfig<T extends "string" | "integer" = "string" | "integer"> = Prettify<
  {
    start: number;
    maxValue?: number;
  } & (T extends "string"
    ? {
        format?: string;
      }
    : object)
>;

export interface DBFieldMetadata extends FieldMetadata {
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  foreignKeyType?: string;
  foreignKeyField?: string;
  // Hooks are user-defined and may depend on runtime data.
  // oxlint-disable-next-line no-explicit-any
  hooks?: Hook<any, any>;
  serial?: SerialConfig;
  relation?: boolean;
}

export interface DefinedDBFieldMetadata extends DefinedFieldMetadata {
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  foreignKeyType?: boolean;
  validate?: boolean;
  hooks?: {
    create: boolean;
    update: boolean;
  };
  serial?: boolean;
  relation?: boolean;
}

export type ExcludeNestedDBFields<T extends Record<string, TailorAnyDBField>> = {
  // Nested types depend on generic output; exclude them via a loose match.
  // oxlint-disable-next-line no-explicit-any
  [K in keyof T]: T[K] extends TailorDBField<{ type: "nested"; array: boolean }, any>
    ? never
    : T[K];
};

type HookFn<TValue, TData, TReturn> = (args: {
  value: TValue;
  data: TData extends Record<string, unknown>
    ? { readonly [K in keyof TData]?: TData[K] | null | undefined }
    : unknown;
  user: TailorUser;
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

export type IndexDef<T extends { fields: Record<PropertyKey, unknown> }> = {
  fields: [keyof T["fields"], keyof T["fields"], ...(keyof T["fields"])[]];
  unique?: boolean;
  name?: string;
};

/**
 * Configuration for GraphQL operations on a TailorDB type.
 * All operations are enabled by default (undefined or true = enabled, false = disabled).
 */
export interface GqlOperations {
  /** Enable create mutation (default: true) */
  create?: boolean;
  /** Enable update mutation (default: true) */
  update?: boolean;
  /** Enable delete mutation (default: true) */
  delete?: boolean;
  /** Enable read queries - get, list, aggregation (default: true) */
  read?: boolean;
}

/**
 * Alias for common GqlOperations configurations.
 * - "query": Read-only mode - disables all mutations (create, update, delete)
 */
export type GqlOperationsAliasQuery = "query";

/**
 * Configuration for GraphQL operations - either an alias string or detailed object.
 */
export type GqlOperationsConfig = GqlOperationsAliasQuery | GqlOperations;

/**
 * Normalize GqlOperationsConfig (alias or object) to GqlOperations object.
 * "query" alias expands to read-only mode: { create: false, update: false, delete: false, read: true }
 * @param config - The GqlOperationsConfig to normalize
 * @returns The normalized GqlOperations object
 */
export function normalizeGqlOperations(config: GqlOperationsConfig): GqlOperations {
  if (config === "query") {
    return { create: false, update: false, delete: false, read: true };
  }
  return config;
}

export interface TypeFeatures {
  pluralForm?: string;
  aggregation?: true;
  bulkUpsert?: true;
  /** Configure GraphQL operations for this type. Use "query" for read-only mode, or an object for granular control. */
  gqlOperations?: GqlOperationsConfig;
}
