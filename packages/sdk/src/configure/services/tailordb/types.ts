// TailorDB structural types and configure-facing config types.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type {
  DefinedFieldMetadata,
  FieldMetadata,
  TailorField,
  TailorFieldType,
} from "#/configure/types/field.types";
import type { InferredAttributes, TailorPrincipal } from "#/runtime/types";
import type { DeepReadonly, InferFieldsOutput, output, Prettify } from "#/types/helpers";
import type {
  DBFieldMetadata as DBFieldMetadataGenerated,
  GqlOperationsInput,
  RawPermissions,
  TailorDBServiceConfigInput,
} from "#/types/tailordb.generated";

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
  // oxlint-disable-next-line typescript/no-unsafe-function-type
  typeHook?: { create?: Function; update?: Function };
  // oxlint-disable-next-line typescript/no-unsafe-function-type
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
  // Default kept loose for convenience; callers still get fully inferred types from `db.table()`.
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributes,
> = TailorDBType<Fields, User>;

// --- Hook types (UX-focused, for configure layer) ---

type HookArgs<TData> =
  TData extends Record<string, unknown>
    ? { readonly [K in keyof TData]?: DeepReadonly<TData[K]> | null | undefined }
    : unknown;

type CreateHookFn<TValue, TReturn> = (args: {
  input: TValue;
  invoker: TailorPrincipal | null;
  now: Date;
}) => TReturn;

type UpdateHookFn<TValue, TReturn> = (args: {
  input: TValue;
  oldValue: TReturn;
  invoker: TailorPrincipal | null;
  now: Date;
}) => TReturn;

export type Hook<TReturn, TCreateReturn = TReturn> = {
  create?: CreateHookFn<TReturn | null, TCreateReturn>;
  update?: UpdateHookFn<TReturn | null, TReturn>;
};

type DotJoin<A extends string, B extends string> = A extends "" ? B : `${A}.${B}`;

type DottedPaths<T, Prefix extends string = ""> = string extends keyof T
  ? string
  : T extends readonly (infer E)[]
    ? E extends Record<string, unknown>
      ? {
          [K in keyof E & string]:
            | `${Prefix}[${number}].${K}`
            | DottedPaths<NonNullable<E[K]>, `${Prefix}[${number}].${K}`>;
        }[keyof E & string]
      : never
    : T extends Record<string, unknown>
      ? {
          [K in keyof T & string]:
            | DotJoin<Prefix, K>
            | DottedPaths<NonNullable<T[K]>, DotJoin<Prefix, K>>;
        }[keyof T & string]
      : never;

export type TypeValidateFn<
  F extends Record<string, TailorAnyDBField>,
  TData = { [K in keyof F]: output<F[K]> },
> = (
  args: {
    newRecord: DeepReadonly<TData>;
    oldRecord: DeepReadonly<TData> | null;
    invoker: TailorPrincipal | null;
  },
  issues: (field: DottedPaths<Omit<TData, "id">>, message: string) => void,
) => void;

type TypeCreateHookFn<
  F extends Record<string, TailorAnyDBField>,
  TData = { [K in keyof F]: output<F[K]> },
> = (args: { input: DeepReadonly<TData>; invoker: TailorPrincipal | null; now: Date }) => {
  [K in Exclude<keyof TData & string, "id">]?: TData[K] | null;
};

type TypeUpdateHookFn<
  F extends Record<string, TailorAnyDBField>,
  TData = { [K in keyof F]: output<F[K]> },
> = (args: {
  input: HookArgs<TData>;
  oldRecord: DeepReadonly<TData>;
  invoker: TailorPrincipal | null;
  now: Date;
}) => { [K in Exclude<keyof TData & string, "id">]?: TData[K] | null };

export type TypeHook<F extends Record<string, TailorAnyDBField>> = {
  create?: TypeCreateHookFn<F>;
  update?: TypeUpdateHookFn<F>;
};

// --- Field helper types ---

/**
 * `true` when callers can never write this field — a field defined with `.serial()`,
 * whose value the platform assigns.
 *
 * Use this to keep such fields out of create and update inputs derived from a field
 * collection. `output<F>` alone cannot express it: the field reads back as
 * non-nullable even though the caller never writes it.
 */
export type IsReadOnlyDBField<F extends TailorAnyDBField> = F["_defined"] extends { serial: true }
  ? true
  : false;

/**
 * `true` when callers may omit this field on create and the platform fills it in — a
 * field defined with `.default()` or `.hooks({ create })`.
 *
 * Use this to make such fields optional in create inputs derived from a field
 * collection. `output<F>` alone cannot express it: the field reads back as
 * non-nullable once created, yet supplying it on create is optional.
 */
export type IsAutoFilledDBField<F extends TailorAnyDBField> = F["_defined"] extends
  | { default: true }
  | { hooks: { create: true } }
  ? true
  : false;

export type ExcludeNestedDBFields<T extends Record<string, TailorAnyDBField>> = {
  // Nested types depend on generic output; exclude them via a loose match.
  // oxlint-disable-next-line no-explicit-any
  [K in keyof T]: T[K] extends TailorDBField<{ type: "nested"; array: boolean }, any>
    ? never
    : T[K];
};

// oxlint-disable no-explicit-any -- conditional type matching requires `any` for the output param
export type ExcludeHookedDBFields<T extends Record<string, TailorAnyDBField>> = {
  [K in keyof T]: T[K] extends TailorDBField<
    { type: TailorFieldType; array: boolean; hooks: { create: true; update: boolean } },
    any
  >
    ? never
    : T[K] extends TailorDBField<
          { type: TailorFieldType; array: boolean; hooks: { create: boolean; update: true } },
          any
        >
      ? never
      : T[K];
};

export type ExcludeDefaultedDBFields<T extends Record<string, TailorAnyDBField>> = {
  [K in keyof T]: T[K] extends TailorDBField<
    { type: TailorFieldType; array: boolean; default: true },
    any
  >
    ? never
    : T[K];
};
// oxlint-enable no-explicit-any

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
