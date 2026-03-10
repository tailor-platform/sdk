import { type TailorUser } from "@/configure/types";
import { type output, type Prettify } from "@/configure/types/helpers";
import { type DefinedFieldMetadata, type FieldMetadata } from "@/configure/types/types";
import { type TailorAnyDBField, type TailorDBField } from "./schema";
export type { TailorDBServiceConfig } from "@/types/tailordb.generated";
export type {
  TailorDBExternalConfig,
  TailorDBMigrationConfig,
  TailorDBServiceInput,
} from "@/types/tailordb";
import type { GqlOperationsInput } from "@/types/tailordb.generated";
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
  scale?: number;
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

export type GqlOperationsConfig = GqlOperationsInput;

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
