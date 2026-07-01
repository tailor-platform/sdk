// TailorDB structural types and configure-facing config types.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type {
  DefinedFieldMetadata,
  FieldMetadata,
  TailorField,
} from "#/configure/types/field.types";
import type { InferredAttributes, TailorPrincipal } from "#/runtime/types";
import type { InferFieldsOutput, output, Prettify } from "#/types/helpers";
import type {
  DBFieldMetadata as DBFieldMetadataGenerated,
  GqlOperationsInput,
  RawPermissions,
  TailorDBServiceConfigInput,
} from "#/types/tailordb.generated";
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
  /** Lifecycle hooks for the field */
  hooks?: DBFieldMetadataGenerated["hooks"];
  serial?: SerialConfig;
  relation?: boolean;
  scale?: number;
  default?: unknown;
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
  default?: boolean;
}

export type GqlOperationsConfig = GqlOperationsInput;

export interface RawRelationConfig {
  type: "1-1" | "n-1" | "keyOnly" | "oneToOne" | "manyToOne" | "N-1";
  toward: {
    type: string;
    as?: string;
    key?: string;
  };
  backward?: string;
}

export interface TailorDBTypeMetadata {
  name: string;
  description?: string;
  settings?: {
    pluralForm?: string;
    aggregation?: boolean;
    bulkUpsert?: boolean;
    gqlOperations?: GqlOperationsConfig;
    publishEvents?: boolean;
  };
  permissions: RawPermissions;
  files: Record<string, string>;
  indexes?: Record<
    string,
    {
      fields: string[];
      unique?: boolean;
    }
  >;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  typeValidate?: Function;
}

/**
 * Minimal structural interface for TailorDBField.
 * Defines only the properties needed by parser, plugin, cli, and types layers.
 * The full interface with builder methods (relation, index, unique, hooks, validate, etc.)
 * is defined in configure/services/tailordb/schema.ts.
 */
export interface TailorDBField<
  Defined extends DefinedDBFieldMetadata = DefinedDBFieldMetadata,
  // oxlint-disable-next-line no-explicit-any
  Output = any,
> extends Omit<TailorField<Defined, Output, DBFieldMetadata, Defined["type"]>, "fields"> {
  readonly fields: Record<string, TailorAnyDBField>;
  readonly rawRelation: Readonly<RawRelationConfig> | undefined;
}

// Helper alias: DB fields can be arbitrarily nested, so we intentionally keep this loose.
// oxlint-disable-next-line no-explicit-any
export type TailorAnyDBField = TailorDBField<any, any>;

/**
 * Minimal structural interface for TailorDBType.
 * Defines only the properties needed by parser, plugin, cli, and types layers.
 * The full interface with builder methods (hooks, validate, features, permission, etc.)
 * is defined in configure/services/tailordb/schema.ts.
 */
export interface TailorDBType<
  // Default kept loose to avoid forcing callers to supply generics.
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  // Generic parameter kept for compatibility with full TailorDBType in configure/
  // oxlint-disable-next-line no-unused-vars
  User extends object = InferredAttributes,
> {
  readonly name: string;
  readonly fields: Fields;
  readonly _output: InferFieldsOutput<Fields>;
  readonly metadata: TailorDBTypeMetadata;
  readonly plugins: PluginAttachment[];
}

// Helper alias
// oxlint-disable-next-line no-explicit-any
export type TailorAnyDBType = TailorDBType<any, any>;

export type TailorDBInstance<
  // Default kept loose for convenience; callers still get fully inferred types from `db.type()`.
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributes,
> = TailorDBType<Fields, User>;

// --- Hook types (UX-focused, for configure layer) ---

type HookArgs<TData> =
  TData extends Record<string, unknown>
    ? { readonly [K in keyof TData]?: TData[K] | null | undefined }
    : unknown;

type HookFn<TValue, TData, TReturn> = (args: {
  value: TValue;
  newRecord: HookArgs<TData>;
  oldRecord: HookArgs<TData> | null;
  invoker: TailorPrincipal | null;
  now: Date;
}) => TReturn;

export type Hook<TData, TReturn, TCreateReturn = TReturn> = {
  create?: HookFn<TReturn | null, TData, TCreateReturn>;
  update?: HookFn<TReturn | null, TData, TReturn>;
};

type DottedPaths<T, Prefix extends string = ""> =
  T extends Record<string, unknown>
    ? {
        [K in keyof T & string]: `${Prefix}${K}` | DottedPaths<NonNullable<T[K]>, `${Prefix}${K}.`>;
      }[keyof T & string]
    : never;

export type TypeValidateFn<
  F extends Record<string, TailorAnyDBField>,
  TData = { [K in keyof F]: output<F[K]> },
> = (
  args: {
    newRecord: HookArgs<TData>;
    oldRecord: HookArgs<TData> | null;
    invoker: TailorPrincipal | null;
  },
  issues: (field: DottedPaths<Omit<TData, "id">>, message: string) => void,
) => void;

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
      : K]?: F[K]["_defined"] extends { default: unknown }
    ? Hook<TData, output<F[K]>, output<F[K]> | null | undefined>
    : Hook<TData, output<F[K]>>;
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

/**
 * Plugin attachment stored on TailorAnyDBType instances.
 */
export interface PluginAttachment {
  pluginId: string;
  config: unknown;
}

// --- Service config types ---

export type IndexDef<T extends { fields: Record<PropertyKey, unknown> }> = {
  fields: [keyof T["fields"], keyof T["fields"], ...(keyof T["fields"])[]];
  unique?: boolean;
  name?: string;
};

export type RelationType = "1-1" | "oneToOne" | "n-1" | "manyToOne" | "N-1" | "keyOnly";

export type TailorDBExternalConfig = { external: true };

export type TailorDBServiceInput = {
  [namespace: string]: TailorDBServiceConfigInput | TailorDBExternalConfig;
};
