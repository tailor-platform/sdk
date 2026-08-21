import { cloneDeep } from "es-toolkit";
import {
  type AllowedValues,
  type AllowedValuesOutput,
  mapAllowedValues,
} from "#/configure/types/field";
import {
  parseInternal as parseFieldInternal,
  type FieldParseArgs,
  type FieldParseInternalArgs,
} from "#/runtime/field-parse";
import { brandValue } from "#/utils/brand";
import type {
  FieldOptions,
  FieldOutput,
  TailorFieldType,
  TailorToTs,
  FieldValidateInput,
} from "#/configure/types/field.types";
import type {
  PrecompiledScriptExprKey,
  PrecompiledScriptExprMap,
} from "#/parser/service/tailordb/types";
import type { PluginAttachment, PluginConfigs } from "#/plugin/types";
import type { InferredAttributes } from "#/runtime/types";
import type { output, InferFieldsOutput, TypeLevelError } from "#/types/helpers";
import type { RawPermissions } from "#/types/tailordb.generated";
import type { TailorTypeGqlPermission, TailorTypePermission } from "./permission";
import type {
  TailorDBField as TailorDBFieldBase,
  TailorDBType as TailorDBTypeBase,
  DBFieldMetadata,
  DefinedDBFieldMetadata,
  SerialConfig,
  IndexDef,
  TailorDBTypeMetadata,
  RawRelationConfig,
  RelationType,
  Hook,
  TypeHook,
  UpdateHookFn,
  ExcludeNestedDBFields,
  ExcludeHookedDBFields,
  ExcludeDefaultedDBFields,
  TypeFeatures,
  TypeValidateFn,
} from "./types";
import type { StandardSchemaV1 } from "@standard-schema/spec";

// Erased DB fields stay assignable across builder method-state changes.
// oxlint-disable-next-line no-explicit-any
type AnyBuilderMethod = any;

export type TailorAnyDBField = Omit<
  TailorDBFieldBase<AnyBuilderMethod, AnyBuilderMethod>,
  "fields"
> & {
  readonly fields: Record<string, AnyBuilderMethod>;
  _metadata: DBFieldMetadata;
  parse: AnyBuilderMethod;
  readonly typeName: TypeLevelError<string>;
  description: AnyBuilderMethod;
  relation: AnyBuilderMethod;
  index: AnyBuilderMethod;
  unique: AnyBuilderMethod;
  vector: AnyBuilderMethod;
  default: AnyBuilderMethod;
  hooks: AnyBuilderMethod;
  validate: AnyBuilderMethod;
  serial: AnyBuilderMethod;
  clone: AnyBuilderMethod;
};

// Helper alias
// oxlint-disable-next-line no-explicit-any
export type TailorAnyDBType = TailorDBType<any, any, any>;

type IsAny<T> = 0 extends 1 & T ? true : false;
type DBFieldTypeNameMethod<Defined extends DefinedDBFieldMetadata> =
  IsAny<Defined> extends true
    ? TypeLevelError<string>
    : TypeLevelError<"typeName cannot be used on TailorDB fields">;

type WithDBFieldDescription<Defined> = Defined & { description: true };
type WithDBFieldRelation<Defined, S extends RelationType | RelationSelfConfig> = S extends
  | "oneToOne"
  | "1-1"
  ? Defined & { unique: true; index: true; relation: true }
  : S extends { type: "oneToOne" | "1-1" }
    ? Defined & { unique: true; index: true; relation: true }
    : Defined & { index: true; relation: true };
type WithDBFieldIndex<Defined> = Defined & { index: true };
type WithDBFieldUnique<Defined> = Defined & { unique: true; index: true };
type WithDBFieldVector<Defined> = Defined & { vector: true };
type WithDBFieldHooks<Defined, H> = Defined & {
  hooks: {
    create: H extends { create: unknown } ? true : false;
    update: H extends { update: unknown } ? true : false;
  };
  serial: false;
};
type WithDBFieldDefault<Defined> = Defined & { default: true };
type WithDBFieldValidate<Defined> = Defined & { validate: true };
type WithDBFieldSerial<Defined> = Defined & {
  serial: true;
  hooks: { create: false; update: false };
};
type WithDBFieldCloneOptions<Defined extends DefinedDBFieldMetadata, NewOpt extends FieldOptions> =
  IsAny<Defined> extends true
    ? Defined
    : Omit<Defined, "array"> & {
        array: NewOpt extends { array: true }
          ? true
          : NewOpt extends { array: false }
            ? false
            : Defined["array"];
      };
type NonNullableDBFieldOutput<Output> = Exclude<Output, null>;
type DBFieldScalarOutput<Output> =
  NonNullableDBFieldOutput<Output> extends (infer Item)[] ? Item : NonNullableDBFieldOutput<Output>;
type DBFieldCloneArrayOutput<Output, NewOpt extends FieldOptions> = NewOpt extends {
  array: true;
}
  ? DBFieldScalarOutput<Output>[]
  : NewOpt extends { array: false }
    ? DBFieldScalarOutput<Output>
    : NonNullableDBFieldOutput<Output>;
type DBFieldCloneOutput<Output, NewOpt extends FieldOptions> = NewOpt extends { optional: true }
  ? DBFieldCloneArrayOutput<Output, NewOpt> | null
  : NewOpt extends { optional: false }
    ? DBFieldCloneArrayOutput<Output, NewOpt>
    : null extends Output
      ? DBFieldCloneArrayOutput<Output, NewOpt> | null
      : DBFieldCloneArrayOutput<Output, NewOpt>;
type DBFieldCloneOptions<Defined extends DefinedDBFieldMetadata> = Omit<FieldOptions, "array"> & {
  array?: Defined extends { validate: unknown } ? Defined["array"] : boolean;
};
type InvalidValidatedArrayCloneKeys<
  Fields extends Record<string, TailorAnyDBField>,
  K extends keyof Fields,
  Opt extends FieldOptions,
> = Opt extends { array: infer ArrayOption }
  ? {
      [P in K]: Fields[P] extends TailorDBField<infer Defined, infer _Output>
        ? Defined extends { validate: unknown }
          ? ArrayOption extends Defined["array"]
            ? never
            : P
          : never
        : never;
    }[K]
  : never;
type DBFieldsCloneOptionsGuard<
  Fields extends Record<string, TailorAnyDBField>,
  K extends keyof Fields,
  Opt extends FieldOptions,
> = [InvalidValidatedArrayCloneKeys<Fields, K, Opt>] extends [never]
  ? unknown
  : TypeLevelError<"array cannot be changed on fields with custom validation">;
type DefinedDBTypeMetadata = {
  hooks?: true;
  validate?: true;
  features?: true;
  indexes?: true;
  files?: true;
  permission?: true;
  gqlPermission?: true;
  description?: true;
};
type WithDBTypeMetadata<
  Defined extends DefinedDBTypeMetadata,
  Key extends keyof DefinedDBTypeMetadata,
> = Defined & Record<Key, true>;
type DBTypeDuplicateInputGuard<
  Defined extends DefinedDBTypeMetadata,
  Key extends keyof DefinedDBTypeMetadata,
  Input,
  Message extends string,
> =
  IsAny<Defined> extends true
    ? Input
    : Defined extends Record<Key, unknown>
      ? TypeLevelError<Message>
      : Input;
type DBTypeDuplicateRestGuard<
  Defined extends DefinedDBTypeMetadata,
  Key extends keyof DefinedDBTypeMetadata,
  Input extends unknown[],
  Message extends string,
> =
  IsAny<Defined> extends true
    ? Input
    : Defined extends Record<Key, unknown>
      ? [TypeLevelError<Message>, ...TypeLevelError<Message>[]]
      : Input;
type FileKeyConflictError<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
> = Partial<
  Record<
    keyof output<TailorDBType<Fields, User>> & string,
    TypeLevelError<"file keys cannot use existing field names">
  >
>;
type DBFieldDescriptionFn<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> = (description: string) => TailorDBField<WithDBFieldDescription<Defined>, Output, Nested>;
type DBFieldRelationFn<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> = {
  <S extends RelationType, T extends TailorAnyDBType>(
    config: RelationConfig<S, T>,
  ): TailorDBField<WithDBFieldRelation<Defined, S>, Output, Nested>;
  <S extends RelationSelfConfig>(
    config: S,
  ): TailorDBField<WithDBFieldRelation<Defined, S>, Output, Nested>;
};
type DBFieldIndexFn<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> = () => TailorDBField<WithDBFieldIndex<Defined>, Output, Nested>;
type DBFieldUniqueFn<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> = () => TailorDBField<WithDBFieldUnique<Defined>, Output, Nested>;
type DBFieldVectorFn<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> = () => TailorDBField<WithDBFieldVector<Defined>, Output, Nested>;
type DBFieldHooksFn<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> = <
  const H extends Hook<
    Output,
    Defined extends { default: true } ? Output | null | undefined : Output
  >,
>(
  hooks: H,
) => TailorDBField<WithDBFieldHooks<Defined, H>, Output, Nested>;
type DBFieldValidateFn<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> = (
  ...validate: FieldValidateInput<Output>[]
) => TailorDBField<WithDBFieldValidate<Defined>, Output, Nested>;
type DBFieldSerialFn<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> = (
  config: SerialConfig<Defined["type"] & ("integer" | "string")>,
) => TailorDBField<WithDBFieldSerial<Defined>, Output, Nested>;
type DBFieldDescriptionMethod<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> =
  IsAny<Defined> extends true
    ? DBFieldDescriptionFn<Defined, Output, Nested>
    : Defined extends { description: unknown }
      ? TypeLevelError<".description() has already been set">
      : DBFieldDescriptionFn<Defined, Output, Nested>;
type DBFieldRelationMethod<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> =
  IsAny<Defined> extends true
    ? DBFieldRelationFn<Defined, Output, Nested>
    : Defined extends { relation: unknown }
      ? TypeLevelError<".relation() has already been set">
      : DBFieldRelationFn<Defined, Output, Nested>;
type DBFieldArrayCheck<A extends boolean, Ok, Msg extends string> = A extends true
  ? TypeLevelError<Msg>
  : Ok;
type DBFieldIndexMethod<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> =
  IsAny<Defined> extends true
    ? DBFieldIndexFn<Defined, Output, Nested>
    : Defined extends { index: unknown }
      ? TypeLevelError<".index() has already been set">
      : DBFieldArrayCheck<
          Defined["array"],
          DBFieldIndexFn<Defined, Output, Nested>,
          "index cannot be set on array fields"
        >;
type DBFieldUniqueMethod<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> =
  IsAny<Defined> extends true
    ? DBFieldUniqueFn<Defined, Output, Nested>
    : Defined extends { unique: unknown }
      ? TypeLevelError<".unique() has already been set">
      : DBFieldArrayCheck<
          Defined["array"],
          DBFieldUniqueFn<Defined, Output, Nested>,
          "unique cannot be set on array fields"
        >;
type DBFieldVectorMethod<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> =
  IsAny<Defined> extends true
    ? DBFieldVectorFn<Defined, Output, Nested>
    : Defined extends { vector: unknown }
      ? TypeLevelError<".vector() has already been set">
      : Defined extends { type: "string"; array: false }
        ? DBFieldVectorFn<Defined, Output, Nested>
        : TypeLevelError<"vector can only be set on non-array string fields">;
type DBFieldHooksMethod<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> =
  IsAny<Defined> extends true
    ? DBFieldHooksFn<Defined, Output, Nested>
    : Defined extends {
          serial: true;
          hooks: { create: false; update: false };
        }
      ? TypeLevelError<"hooks cannot be set after serial">
      : Defined extends {
            hooks: unknown;
          }
        ? TypeLevelError<".hooks() has already been set">
        : Defined extends { type: "nested" }
          ? TypeLevelError<"hooks cannot be set on nested type fields">
          : DBFieldHooksFn<Defined, Output, Nested>;
type DBFieldValidateMethod<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> =
  IsAny<Defined> extends true
    ? DBFieldValidateFn<Defined, Output, Nested>
    : Defined extends { validate: unknown }
      ? TypeLevelError<".validate() has already been set">
      : DBFieldValidateFn<Defined, Output, Nested>;
type DBFieldSerialMethod<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> =
  IsAny<Defined> extends true
    ? DBFieldSerialFn<Defined, Output, Nested>
    : Defined extends { serial: true }
      ? TypeLevelError<".serial() has already been set">
      : Defined extends { serial: false }
        ? TypeLevelError<"serial cannot be set after hooks">
        : IsAny<Output> extends true
          ? Defined extends { type: "integer" | "string"; array: false }
            ? DBFieldSerialFn<Defined, Output, Nested>
            : TypeLevelError<"serial can only be set on non-array integer or string fields">
          : null extends Output
            ? TypeLevelError<"serial can only be set on non-array integer or string fields">
            : Defined extends { type: "integer" | "string"; array: false }
              ? DBFieldSerialFn<Defined, Output, Nested>
              : TypeLevelError<"serial can only be set on non-array integer or string fields">;
type DBFieldDefaultFn<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> = (
  value: Output extends null ? NonNullable<Output> : Output,
) => TailorDBField<WithDBFieldDefault<Defined>, Output, Nested>;
type DBFieldDefaultMethod<
  Defined extends DefinedDBFieldMetadata,
  Output,
  Nested extends Record<string, TailorAnyDBField>,
> =
  IsAny<Defined> extends true
    ? DBFieldDefaultFn<Defined, Output, Nested>
    : Defined extends { default: unknown }
      ? TypeLevelError<".default() has already been set">
      : Defined extends { type: "nested" }
        ? TypeLevelError<"default cannot be set on nested type fields">
        : Defined extends { serial: true }
          ? TypeLevelError<"default cannot be set on serial fields">
          : null extends Output
            ? TypeLevelError<"default cannot be set on optional fields">
            : DBFieldDefaultFn<Defined, Output, Nested>;

/**
 * Full TailorDBField interface with builder methods.
 * Extends the minimal structural interface from types/ with fluent API methods.
 */
export interface TailorDBField<
  Defined extends DefinedDBFieldMetadata = DefinedDBFieldMetadata,
  // oxlint-disable-next-line no-explicit-any
  Output = any,
  // Nested object fields, so a `db.object()` field keeps the shape it was declared with.
  // Every builder method passes it through; dropping it here would erase the shape as
  // soon as one is chained.
  Nested extends Record<string, TailorAnyDBField> = Record<string, TailorAnyDBField>,
> extends Omit<TailorDBFieldBase<Defined, Output, Nested>, "fields"> {
  readonly fields: Nested;
  _metadata: DBFieldMetadata;

  /**
   * Parse and validate a value against this field's validation rules
   */
  parse(args: FieldParseArgs): StandardSchemaV1.Result<Output>;

  /**
   * typeName is not available on TailorDB fields.
   * Use typeName on pipeline fields (t.enum / t.object) instead.
   */
  typeName: DBFieldTypeNameMethod<Defined>;

  /**
   * Set a description for the field
   */
  description: DBFieldDescriptionMethod<Defined, Output, Nested>;

  /**
   * Define a relation to another table.
   */
  relation: DBFieldRelationMethod<Defined, Output, Nested>;

  /**
   * Add an index to the field
   */
  index: DBFieldIndexMethod<Defined, Output, Nested>;

  /**
   * Make the field unique (also adds an index)
   */
  unique: DBFieldUniqueMethod<Defined, Output, Nested>;

  /**
   * Enable vector search on the field (string type only)
   */
  vector: DBFieldVectorMethod<Defined, Output, Nested>;

  /**
   * Set a default value for the field on create. When the field is required,
   * this makes it optional in the Create input — the default fills in when
   * no value (or a nullish hook result) is provided.
   *
   * For datetime/date/time fields, pass `"now"` to use the operation timestamp.
   */
  default: DBFieldDefaultMethod<Defined, Output, Nested>;

  /**
   * Add hooks for create/update operations on this field.
   */
  hooks: DBFieldHooksMethod<Defined, Output, Nested>;

  /**
   * Add validation functions to the field.
   *
   * Validators receive `{ value, data, user }` and run after hooks and
   * built-in type validation; they are skipped when built-in validation
   * fails. For array fields, `value` is the complete array.
   */
  validate: DBFieldValidateMethod<Defined, Output, Nested>;

  /**
   * Configure serial/auto-increment behavior
   */
  serial: DBFieldSerialMethod<Defined, Output, Nested>;

  /**
   * Clone the field with optional overrides for field options.
   * The `array` option cannot change on fields with custom validation.
   */
  clone<const NewOpt extends DBFieldCloneOptions<Defined>>(
    options?: NewOpt,
  ): TailorDBField<
    WithDBFieldCloneOptions<Defined, NewOpt>,
    DBFieldCloneOutput<Output, NewOpt>,
    Nested
  >;
}

/**
 * Full TailorDBType interface with builder methods.
 * Extends the minimal structural interface from types/ with fluent API methods.
 */
export interface TailorDBType<
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributes,
  // oxlint-disable-next-line no-explicit-any
  Defined extends DefinedDBTypeMetadata = any,
> extends TailorDBTypeBase<Fields, User> {
  _description?: string;

  hooks(
    hook: DBTypeDuplicateInputGuard<
      Defined,
      "hooks",
      TypeHook<Fields>,
      ".hooks() has already been set"
    >,
  ): TailorDBType<Fields, User, WithDBTypeMetadata<Defined, "hooks">>;
  validate(
    fn: DBTypeDuplicateInputGuard<
      Defined,
      "validate",
      TypeValidateFn<Fields>,
      ".validate() has already been set"
    >,
  ): TailorDBType<Fields, User, WithDBTypeMetadata<Defined, "validate">>;
  features(
    features: DBTypeDuplicateInputGuard<
      Defined,
      "features",
      Omit<TypeFeatures, "pluralForm">,
      ".features() has already been set"
    >,
  ): TailorDBType<Fields, User, WithDBTypeMetadata<Defined, "features">>;
  indexes(
    ...indexes: DBTypeDuplicateRestGuard<
      Defined,
      "indexes",
      IndexDef<TailorDBType<Fields, User, Defined>>[],
      ".indexes() has already been set"
    >
  ): TailorDBType<Fields, User, WithDBTypeMetadata<Defined, "indexes">>;
  files<const F extends string>(
    files: DBTypeDuplicateInputGuard<
      Defined,
      "files",
      Record<F, string> & FileKeyConflictError<Fields, User>,
      ".files() has already been set"
    >,
  ): TailorDBType<Fields, User, WithDBTypeMetadata<Defined, "files">>;
  permission<
    U extends object = User,
    P extends TailorTypePermission<U, output<TailorDBType<Fields, User, Defined>>> =
      TailorTypePermission<U, output<TailorDBType<Fields, User, Defined>>>,
  >(
    permission: DBTypeDuplicateInputGuard<
      Defined,
      "permission",
      P,
      ".permission() has already been set"
    >,
  ): TailorDBType<Fields, U, WithDBTypeMetadata<Defined, "permission">>;
  gqlPermission<
    U extends object = User,
    P extends TailorTypeGqlPermission<U> = TailorTypeGqlPermission<U>,
  >(
    permission: DBTypeDuplicateInputGuard<
      Defined,
      "gqlPermission",
      P,
      ".gqlPermission() has already been set"
    >,
  ): TailorDBType<Fields, U, WithDBTypeMetadata<Defined, "gqlPermission">>;
  description(
    description: DBTypeDuplicateInputGuard<
      Defined,
      "description",
      string,
      ".description() has already been set"
    >,
  ): TailorDBType<Fields, User, WithDBTypeMetadata<Defined, "description">>;
  pickFields<K extends keyof Fields>(keys: K[]): Pick<Fields, K>;
  pickFields<K extends keyof Fields, const Opt extends FieldOptions>(
    keys: K[],
    options: Opt & DBFieldsCloneOptionsGuard<Fields, K, Opt>,
  ): {
    [P in K]: Fields[P] extends TailorDBField<infer D, infer O>
      ? TailorDBField<WithDBFieldCloneOptions<D, Opt>, DBFieldCloneOutput<O, Opt>>
      : never;
  };
  omitFields<K extends keyof Fields>(keys: K[]): Omit<Fields, K>;
  plugin<P extends keyof PluginConfigs<keyof Fields & string>>(config: {
    [K in P]: PluginConfigs<keyof Fields & string>[K];
  }): TailorDBType<Fields, User, Defined>;
}

export type TailorDBInstance<
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributes,
  // oxlint-disable-next-line no-explicit-any
  Defined extends DefinedDBTypeMetadata = any,
> = TailorDBType<Fields, User, Defined>;

interface RelationConfig<S extends RelationType, T extends TailorDBType> {
  type: S;
  toward: {
    type: T;
    as?: string;
    key?: keyof T["fields"] & string;
  };
  backward?: string;
}

// Special config variant for self-referencing relations
type RelationSelfConfig = {
  type: RelationType;
  toward: {
    type: "self";
    as?: string;
    key?: string;
  };
  backward?: string;
};

function isRelationSelfConfig(
  config: RelationConfig<RelationType, TailorDBType> | RelationSelfConfig,
): config is RelationSelfConfig {
  return config.toward.type === "self";
}

type DBFieldDefined<T extends TailorFieldType, Opt extends FieldOptions> = {
  type: T;
  array: Opt extends { array: true } ? true : false;
};
type DBFieldOutput<
  T extends TailorFieldType,
  Opt extends FieldOptions,
  OutputBase = TailorToTs[T],
> = FieldOutput<OutputBase, Opt>;
type TailorDBFieldInstance<
  T extends TailorFieldType,
  Opt extends FieldOptions,
  OutputBase = TailorToTs[T],
> = TailorDBField<DBFieldDefined<T, Opt>, DBFieldOutput<T, Opt, OutputBase>>;
type TailorDBFieldRuntimeInstance<
  T extends TailorFieldType,
  Opt extends FieldOptions,
  OutputBase = TailorToTs[T],
> = TailorDBFieldRuntime<DBFieldDefined<T, Opt>, DBFieldOutput<T, Opt, OutputBase>>;
type TailorDBFieldRuntime<Defined extends DefinedDBFieldMetadata, Output> = Omit<
  TailorDBFieldBase<Defined, Output>,
  "fields"
> & {
  readonly fields: Record<string, TailorAnyDBField>;
  _metadata: DBFieldMetadata;
  description(description: string): object;
  typeName(typeName: string): object;
  validate(...validate: FieldValidateInput<Output>[]): object;
  relation(config: RelationConfig<RelationType, TailorDBType> | RelationSelfConfig): object;
  index(): object;
  unique(): object;
  vector(): object;
  default(value: unknown): object;
  hooks(hooks: Hook<Output>): object;
  serial(config: SerialConfig): object;
  clone(options?: FieldOptions): TailorDBFieldRuntime<DefinedDBFieldMetadata, AnyBuilderMethod>;
  parse(args: FieldParseArgs): StandardSchemaV1.Result<Output>;
  _setRawRelation(relation: RawRelationConfig): void;
};

/**
 * Creates a new TailorDBField instance.
 * @param type - Field type
 * @param options - Field options
 * @param fields - Nested fields for object-like types
 * @param values - Allowed values for enum-like fields
 * @returns A new TailorDBField
 */
function createTailorDBField<
  const T extends TailorFieldType,
  const TOptions extends FieldOptions,
  const OutputBase = TailorToTs[T],
>(
  type: T,
  options?: TOptions,
  fields?: Record<string, TailorAnyDBField>,
  values?: AllowedValues,
): TailorDBFieldInstance<T, TOptions, OutputBase>;
function createTailorDBField<const T extends TailorFieldType, const TOptions extends FieldOptions>(
  type: T,
  options?: TOptions,
  fields?: Record<string, TailorAnyDBField>,
  values?: AllowedValues,
): object {
  return createTailorDBFieldRuntime(type, options, fields, values);
}

function createTailorDBFieldRuntime<
  const T extends TailorFieldType,
  const TOptions extends FieldOptions,
  const OutputBase = TailorToTs[T],
>(
  type: T,
  options?: TOptions,
  fields?: Record<string, TailorAnyDBField>,
  values?: AllowedValues,
): TailorDBFieldRuntimeInstance<T, TOptions, OutputBase> {
  type FieldValue = DBFieldOutput<T, TOptions, OutputBase>;
  type FieldType = TailorDBFieldRuntimeInstance<T, TOptions, OutputBase>;

  const _metadata: DBFieldMetadata = { required: true };
  let _rawRelation: RawRelationConfig | undefined;

  if (options) {
    if (options.optional === true) {
      _metadata.required = false;
    }
    if (options.array === true) {
      _metadata.array = true;
    }
  }
  if (values) {
    _metadata.allowedValues = mapAllowedValues(values);
  }

  function parseInternal(args: FieldParseInternalArgs): StandardSchemaV1.Result<FieldValue> {
    return parseFieldInternal<T, FieldValue>({
      ...args,
      field,
    });
  }

  function cloneWith(metadataUpdates: Partial<DBFieldMetadata>) {
    const cloned = field.clone();
    Object.assign(cloned._metadata, metadataUpdates);
    return cloned;
  }

  const field: FieldType = {
    type,
    fields: fields ?? {},
    _defined: undefined as unknown as DBFieldDefined<T, TOptions>,
    _output: undefined as FieldValue,
    _metadata,

    get metadata() {
      return { ...this._metadata };
    },

    get rawRelation(): Readonly<RawRelationConfig> | undefined {
      return _rawRelation ? { ..._rawRelation, toward: { ..._rawRelation.toward } } : undefined;
    },

    description(description: string) {
      return cloneWith({ description });
    },

    typeName(typeName: string) {
      return cloneWith({ typeName });
    },

    validate(...validateInputs: FieldValidateInput<FieldValue>[]) {
      return cloneWith({ validate: validateInputs });
    },

    parse(args: FieldParseArgs): StandardSchemaV1.Result<FieldValue> {
      return parseInternal({
        value: args.value,
        data: args.data,
        invoker: args.invoker,
        pathArray: [],
      });
    },

    // TailorDBField specific methods
    relation(config: RelationConfig<RelationType, TailorDBType> | RelationSelfConfig) {
      const cloned = field.clone();
      const targetType = isRelationSelfConfig(config) ? "self" : config.toward.type.name;
      cloned._setRawRelation({
        type: config.type,
        toward: {
          type: targetType,
          as: config.toward.as,
          key: config.toward.key,
        },
        backward: config.backward,
      });
      return cloned;
    },

    index() {
      return cloneWith({ index: true });
    },

    unique() {
      return cloneWith({ unique: true, index: true });
    },

    vector() {
      return cloneWith({ vector: true });
    },

    // oxlint-disable-next-line no-explicit-any
    default(value: any) {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ default: value }) as any;
    },

    hooks(hooks: Hook<FieldValue>) {
      return cloneWith({ hooks });
    },

    serial(config: SerialConfig) {
      return cloneWith({ serial: config });
    },

    clone(cloneOptions?: FieldOptions) {
      if (
        this._metadata.validate?.length &&
        cloneOptions?.array !== undefined &&
        cloneOptions.array !== (this._metadata.array === true)
      ) {
        throw new Error("Cannot change the array option on a field with custom validation");
      }

      // Deep clone nested object fields if present
      let clonedFields = fields;
      if (fields) {
        const cloned: Record<string, TailorAnyDBField> = {};
        for (const [key, field] of Object.entries(fields)) {
          cloned[key] = field.clone();
        }
        clonedFields = cloned;
      }

      // Create a new field with cloned configuration
      const clonedField = createTailorDBFieldRuntime(type, options, clonedFields, values);

      // Deep copy metadata using cloneDeep (preserves function references)
      Object.assign(clonedField._metadata, cloneDeep(this._metadata));

      // Apply new options if provided
      if (cloneOptions) {
        if (cloneOptions.optional !== undefined) {
          clonedField._metadata.required = !cloneOptions.optional;
        }
        if (cloneOptions.array !== undefined) {
          clonedField._metadata.array = cloneOptions.array;
        }
      }

      // Copy raw relation if exists
      if (_rawRelation) {
        clonedField._setRawRelation(cloneDeep(_rawRelation));
      }

      return clonedField;
    },

    _setRawRelation(relation: RawRelationConfig) {
      _rawRelation = relation;
    },
  };

  return field;
}

const createField = createTailorDBField;

/**
 * Create a UUID field.
 * @param options - Field configuration options
 * @returns A UUID field
 * @example db.uuid()
 * @example db.uuid({ optional: true })
 */
function uuid<const Opt extends FieldOptions>(options?: Opt) {
  return createField("uuid", options);
}

/**
 * Create a string field.
 * @param options - Field configuration options
 * @returns A string field
 * @example db.string()
 * @example db.string({ optional: true })
 */
function string<const Opt extends FieldOptions>(options?: Opt) {
  return createField("string", options);
}

/**
 * Create a boolean field.
 * Note: The method name is `bool` but creates a `boolean` type field.
 * @param options - Field configuration options
 * @returns A boolean field
 * @example db.bool()
 * @example db.bool({ optional: true })
 */
function bool<const Opt extends FieldOptions>(options?: Opt) {
  return createField("boolean", options);
}

/**
 * Create an integer field.
 * @param options - Field configuration options
 * @returns An integer field
 * @example db.int()
 * @example db.int({ optional: true })
 */
function int<const Opt extends FieldOptions>(options?: Opt) {
  return createField("integer", options);
}

/**
 * Create a float (decimal number) field.
 * @param options - Field configuration options
 * @returns A float field
 * @example db.float()
 * @example db.float({ optional: true })
 */
function float<const Opt extends FieldOptions>(options?: Opt) {
  return createField("float", options);
}

interface DecimalFieldOptions extends FieldOptions {
  scale?: number;
}

/**
 * Create a decimal field (stored as string for precision).
 * @param options - Field configuration options including optional scale (0-12)
 * @returns A decimal field
 * @example db.decimal()
 * @example db.decimal({ scale: 2 })
 * @example db.decimal({ scale: 2, optional: true })
 */
function decimal<const Opt extends DecimalFieldOptions>(options?: Opt) {
  if (options?.scale !== undefined) {
    if (!Number.isInteger(options.scale) || options.scale < 0 || options.scale > 12) {
      throw new Error("scale must be an integer between 0 and 12");
    }
  }
  const field = createField("decimal", options);
  if (options?.scale !== undefined) {
    field._metadata.scale = options.scale;
  }
  return field;
}

/**
 * Create a date field (date only, no time component).
 * Format: "yyyy-MM-dd"
 * @param options - Field configuration options
 * @returns A date field
 * @example db.date()
 */
function date<const Opt extends FieldOptions>(options?: Opt) {
  return createField("date", options);
}

/**
 * Create a datetime field (date and time).
 * Format: ISO 8601, such as "yyyy-MM-ddTHH:mm:ssZ" or "yyyy-MM-ddTHH:mm:ss+09:00"
 * @param options - Field configuration options
 * @returns A datetime field
 * @example db.datetime()
 */
function datetime<const Opt extends FieldOptions>(options?: Opt) {
  return createField("datetime", options);
}

/**
 * Create a time field (time only, no date component).
 * Format: "HH:mm"
 * @param options - Field configuration options
 * @returns A time field
 * @example db.time()
 */
function time<const Opt extends FieldOptions>(options?: Opt) {
  return createField("time", options);
}

/**
 * Create an enum field with a fixed set of allowed string values.
 * @param values - Array of allowed string values, or array of `{ value, description }` objects
 * @param options - Field configuration options
 * @returns An enum field
 * @example db.enum(["active", "inactive", "suspended"])
 * @example db.enum(["small", "medium", "large"], { optional: true })
 */
function _enum<const V extends AllowedValues, const Opt extends FieldOptions>(
  values: V,
  options?: Opt,
): TailorDBField<
  { type: "enum"; array: Opt extends { array: true } ? true : false },
  FieldOutput<AllowedValuesOutput<V>, Opt>
> {
  return createField<"enum", Opt, AllowedValuesOutput<V>>("enum", options, undefined, values);
}

/**
 * Create a nested object field with sub-fields.
 * @param fields - Record of nested field definitions
 * @param options - Field configuration options
 * @returns A nested object field
 * @example db.object({ street: db.string(), city: db.string(), zip: db.string() })
 * @example db.object({ name: db.string() }, { optional: true })
 */
function object<
  const F extends Record<string, TailorAnyDBField> &
    ExcludeNestedDBFields<F> &
    ExcludeHookedDBFields<F> &
    ExcludeDefaultedDBFields<F>,
  const Opt extends FieldOptions,
>(fields: F, options?: Opt) {
  return createField("nested", options, fields) as unknown as TailorDBField<
    { type: "nested"; array: Opt extends { array: true } ? true : false },
    FieldOutput<InferFieldsOutput<F>, Opt>,
    F
  >;
}

/**
 * Creates a new TailorDBType instance.
 * @param name - Table name
 * @param fields - Field definitions
 * @param options - Table options
 * @param options.pluralForm - Optional plural form
 * @param options.description - Optional description
 * @returns A new TailorDBType
 */
function createTailorDBType<
  // oxlint-disable-next-line no-explicit-any
  const Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributes,
>(
  name: string,
  fields: Fields,
  options: { pluralForm?: string; description?: string },
): TailorDBType<Fields, User, DefinedDBTypeMetadata> {
  let _description = options.description;
  let _settings: TypeFeatures = {};
  let _indexes: IndexDef<TailorDBType<Fields, User, DefinedDBTypeMetadata>>[] = [];
  const _permissions: RawPermissions = {};
  let _files: Record<string, string> = {};
  const _plugins: PluginAttachment[] = [];
  // oxlint-disable-next-line typescript/no-unsafe-function-type
  let _typeHook: { create?: Function; update?: Function } | undefined;
  // oxlint-disable-next-line typescript/no-unsafe-function-type
  let _typeValidate: Function | undefined;
  const _definedMethods = new Set<keyof DefinedDBTypeMetadata>();
  if (options.description !== undefined) {
    _definedMethods.add("description");
  }

  function runMethodOnce<T>(method: keyof DefinedDBTypeMetadata, action: () => T): T {
    if (_definedMethods.has(method)) {
      throw new Error(`.${method}() has already been set`);
    }
    const result = action();
    _definedMethods.add(method);
    return result;
  }
  type TypeAfter<Key extends keyof DefinedDBTypeMetadata> = TailorDBType<
    Fields,
    User,
    WithDBTypeMetadata<DefinedDBTypeMetadata, Key>
  >;
  type TypeAfterUser<
    NextUser extends object,
    Key extends keyof DefinedDBTypeMetadata,
  > = TailorDBType<Fields, NextUser, WithDBTypeMetadata<DefinedDBTypeMetadata, Key>>;

  if (options.pluralForm) {
    if (name === options.pluralForm) {
      throw new Error(`The name and the plural form must be different. name=${name}`);
    }
    _settings.pluralForm = options.pluralForm;
  }

  const dbType: TailorDBType<Fields, User, DefinedDBTypeMetadata> = {
    name,
    fields: { ...fields },
    _output: null as unknown as InferFieldsOutput<Fields>,
    _description,

    get metadata(): TailorDBTypeMetadata {
      // Convert indexes to the format expected by the manifest
      const indexes: Record<string, { fields: string[]; unique?: boolean }> = {};
      if (_indexes.length > 0) {
        _indexes.forEach((index) => {
          const fieldNames = index.fields.map((field) => String(field));
          const key = index.name || `idx_${fieldNames.join("_")}`;
          indexes[key] = {
            fields: fieldNames,
            unique: index.unique,
          };
        });
      }

      return {
        name: this.name,
        description: _description,
        settings: _settings,
        permissions: _permissions,
        files: _files,
        ...(Object.keys(indexes).length > 0 && { indexes }),
        ...(_typeHook && { typeHook: _typeHook }),
        ...(_typeValidate && { typeValidate: _typeValidate }),
      };
    },

    hooks(hook: TypeHook<Fields>): TypeAfter<"hooks"> {
      return runMethodOnce("hooks", () => {
        _typeHook = hook;
        return this as TypeAfter<"hooks">;
      });
    },

    validate(fn: TypeValidateFn<Fields>): TypeAfter<"validate"> {
      return runMethodOnce("validate", () => {
        _typeValidate = fn;
        return this as TypeAfter<"validate">;
      });
    },

    features(features: Omit<TypeFeatures, "pluralForm">): TypeAfter<"features"> {
      return runMethodOnce("features", () => {
        _settings = {
          ..._settings,
          ...features,
        };
        return this as TypeAfter<"features">;
      });
    },

    indexes(
      ...indexes: IndexDef<TailorDBType<Fields, User, DefinedDBTypeMetadata>>[]
    ): TypeAfter<"indexes"> {
      return runMethodOnce("indexes", () => {
        _indexes = indexes;
        return this as TypeAfter<"indexes">;
      });
    },

    files<const F extends string>(
      files: Record<F, string> & FileKeyConflictError<Fields, User>,
    ): TypeAfter<"files"> {
      return runMethodOnce("files", () => {
        _files = files;
        return this as TypeAfter<"files">;
      });
    },

    permission<
      U extends object = User,
      P extends TailorTypePermission<U, output<TailorDBType<Fields, User, DefinedDBTypeMetadata>>> =
        TailorTypePermission<U, output<TailorDBType<Fields, User, DefinedDBTypeMetadata>>>,
    >(permission: P): TypeAfterUser<U, "permission"> {
      return runMethodOnce("permission", () => {
        const ret = this as unknown as TypeAfterUser<U, "permission">;
        _permissions.record = permission as RawPermissions["record"];
        return ret;
      });
    },

    gqlPermission<
      U extends object = User,
      P extends TailorTypeGqlPermission<U> = TailorTypeGqlPermission<U>,
    >(permission: P): TypeAfterUser<U, "gqlPermission"> {
      return runMethodOnce("gqlPermission", () => {
        const ret = this as unknown as TypeAfterUser<U, "gqlPermission">;
        _permissions.gql = permission as RawPermissions["gql"];
        return ret;
      });
    },

    description(description: string): TypeAfter<"description"> {
      return runMethodOnce("description", () => {
        _description = description;
        this._description = description;
        return this as TypeAfter<"description">;
      });
    },

    pickFields<K extends keyof Fields, const Opt extends FieldOptions>(keys: K[], options?: Opt) {
      const result = {} as Record<K, TailorAnyDBField>;
      for (const key of keys) {
        const field = this.fields[key] as TailorAnyDBField;
        if (options) {
          result[key] = field.clone(options);
        } else {
          result[key] = field;
        }
      }
      // oxlint-disable-next-line no-explicit-any
      return result as any;
    },

    omitFields<K extends keyof Fields>(keys: K[]): Omit<Fields, K> {
      const keysSet = new Set(keys);
      const result = {} as Record<string, TailorAnyDBField>;
      for (const key in this.fields) {
        if (Object.hasOwn(this.fields, key) && !keysSet.has(key as unknown as K)) {
          result[key] = this.fields[key] as TailorAnyDBField;
        }
      }
      return result as Omit<Fields, K>;
    },

    get plugins(): PluginAttachment[] {
      return _plugins;
    },

    plugin<P extends keyof PluginConfigs<keyof Fields & string>>(config: {
      [K in P]: PluginConfigs<keyof Fields & string>[K];
    }): TailorDBType<Fields, User, AnyBuilderMethod> {
      for (const [pluginId, pluginConfig] of Object.entries(config)) {
        _plugins.push({ pluginId, config: pluginConfig });
      }
      return this;
    },
  };

  return brandValue(dbType, "tailordb-type");
}

const idField = uuid();
type idField = typeof idField;
type DBTable<
  F extends { id?: never } & Record<string, TailorAnyDBField>,
  Defined extends DefinedDBTypeMetadata = DefinedDBTypeMetadata,
> = TailorDBInstance<{ id: idField } & F, InferredAttributes, Defined>;

/**
 * Creates a new database table with the specified fields.
 * An `id` field (UUID) is automatically added to every table.
 * @param name - The name of the table, or a tuple of [name, pluralForm]
 * @param fields - The field definitions for the table
 * @returns A new TailorDB table instance
 * @example
 * export const user = db.table("User", {
 *   name: db.string(),
 *   email: db.string(),
 *   age: db.int({ optional: true }),
 *   role: db.enum(["admin", "member"]),
 *   ...db.fields.timestamps(),
 * });
 * // Always export both the value and type:
 * export type user = typeof user;
 */
function dbTable<const F extends { id?: never } & Record<string, TailorAnyDBField>>(
  name: string | [string, string],
  fields: F,
): DBTable<F>;
/**
 * Creates a new database table with the specified fields and description.
 * An `id` field (UUID) is automatically added to every table.
 * @param name - The name of the table, or a tuple of [name, pluralForm]
 * @param description - A description of the table
 * @param fields - The field definitions for the table
 * @returns A new TailorDB table instance
 */
function dbTable<const F extends { id?: never } & Record<string, TailorAnyDBField>>(
  name: string | [string, string],
  description: string,
  fields: F,
): DBTable<F, WithDBTypeMetadata<DefinedDBTypeMetadata, "description">>;
function dbTable<const F extends { id?: never } & Record<string, TailorAnyDBField>>(
  name: string | [string, string],
  fieldsOrDescription: string | F,
  fields?: F,
): DBTable<F> | DBTable<F, WithDBTypeMetadata<DefinedDBTypeMetadata, "description">> {
  const typeName = Array.isArray(name) ? name[0] : name;
  const pluralForm = Array.isArray(name) ? name[1] : undefined;

  let description: string | undefined;
  let fieldDef: F;
  if (typeof fieldsOrDescription === "string") {
    description = fieldsOrDescription;
    fieldDef = fields as F;
  } else {
    fieldDef = fieldsOrDescription;
  }
  return createTailorDBType<{ id: idField } & F>(
    typeName,
    {
      id: idField,
      ...fieldDef,
    },
    { pluralForm, description },
  );
}

// `Function.prototype.toString()` of this hook is embedded verbatim into deployed
// schemas and migration diffs (see parser/service/tailordb/hooks-validate-precompiled-expr.ts
// and field.ts). Its source text depends on how the SDK itself was built (e.g.
// minification), so a fixed expression is pinned onto it directly here instead -
// configure cannot import parser's `setPrecompiledScriptExpr` runtime helper across
// the module boundary, only the symbol registry key and map types. Keep
// this literal in sync with the "timestamps() updatedAt hook resolves to the pinned
// expr" test in parser/service/tailordb/field.precompiled.test.ts, which fails if it
// ever drifts from what this hook's own source naturally produces.
type TimestampsUpdatedAtHookFn = UpdateHookFn<string | Date | null, string | Date>;
const timestampsUpdatedAtHook: TimestampsUpdatedAtHookFn = ({ input, now }) => input ?? now;
const PRECOMPILED_EXPR_KEY: PrecompiledScriptExprKey =
  "@tailor-platform/sdk/precompiled-script-expr";
const PRECOMPILED_EXPR_SYMBOL = Symbol.for(PRECOMPILED_EXPR_KEY);
(timestampsUpdatedAtHook as unknown as Record<symbol, PrecompiledScriptExprMap>)[
  PRECOMPILED_EXPR_SYMBOL
] = {
  "hooks.update":
    "(({ input, now }) => input ?? now)({ input: _value, oldValue: _oldValue, invoker: _principal, now: _now })",
};

/** TailorDB schema builder utilities for defining tables and fields. */
export const db = {
  table: dbTable,
  uuid,
  string,
  bool,
  int,
  float,
  decimal,
  date,
  datetime,
  time,
  enum: _enum,
  object,
  fields: {
    /**
     * Creates standard timestamp fields (createdAt, updatedAt) with automatic defaults.
     * Both fields default to the current time on create. updatedAt is also refreshed on update.
     * User-specified values are respected when provided (e.g. seeding historical records).
     * @returns An object with createdAt and updatedAt fields
     * @example
     * const model = db.table("Model", {
     *   name: db.string(),
     *   ...db.fields.timestamps(),
     * });
     */
    timestamps: () => ({
      createdAt: datetime().default("now").description("Record creation timestamp"),
      updatedAt: datetime()
        .default("now")
        .hooks({ update: timestampsUpdatedAtHook })
        .description("Record update timestamp"),
    }),
  },
};
