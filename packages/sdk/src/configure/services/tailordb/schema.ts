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
} from "#/configure/types/field-runtime";
import { brandValue } from "#/utils/brand";
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
} from "#/configure/services/tailordb/types";
import type {
  FieldOptions,
  FieldOutput,
  TailorFieldType,
  TailorToTs,
  FieldValidateInput,
  ValidateConfig,
  Validators,
} from "#/configure/types/field.types";
import type { PluginAttachment, PluginConfigs } from "#/plugin/types";
import type { InferredAttributeMap } from "#/runtime/types";
import type { output, InferFieldsOutput, TypeLevelError } from "#/types/helpers";
import type { RawPermissions } from "#/types/tailordb.generated";
import type { TailorTypeGqlPermission, TailorTypePermission } from "./permission";
import type { Hook, Hooks, ExcludeNestedDBFields, TypeFeatures } from "./types";
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
  _parseInternal: AnyBuilderMethod;
  readonly typeName: TypeLevelError<string>;
  description: AnyBuilderMethod;
  relation: AnyBuilderMethod;
  index: AnyBuilderMethod;
  unique: AnyBuilderMethod;
  vector: AnyBuilderMethod;
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
type WithDBFieldValidate<Defined> = Defined & { validate: true };
type WithDBFieldSerial<Defined> = Defined & {
  serial: true;
  hooks: { create: false; update: false };
};
type WithDBFieldCloneOptions<Defined extends DefinedDBFieldMetadata, NewOpt extends FieldOptions> =
  IsAny<Defined> extends true
    ? Defined
    : Omit<Defined, "array"> & {
        array: NewOpt extends { array: true } ? true : Defined["array"];
      };
type DefinedDBTypeMetadata = {
  hooks?: true;
  validate?: true;
  features?: true;
  indexes?: true;
  files?: true;
  permission?: true;
  gqlPermission?: true;
};
type WithDBTypeMetadata<
  Defined extends DefinedDBTypeMetadata,
  Key extends keyof DefinedDBTypeMetadata,
> = Defined & Record<Key, true>;
type DBTypeDuplicateGuard<
  Defined extends DefinedDBTypeMetadata,
  Key extends keyof DefinedDBTypeMetadata,
  Fn,
  Message extends string,
> =
  IsAny<Defined> extends true
    ? Fn
    : Defined extends Record<Key, unknown>
      ? TypeLevelError<Message>
      : Fn;
type FileKeyConflictError<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
> = Partial<
  Record<
    keyof output<TailorDBType<Fields, User>> & string,
    TypeLevelError<"file keys cannot use existing field names">
  >
>;
type DBFieldDescriptionFn<Defined extends DefinedDBFieldMetadata, Output> = (
  description: string,
) => TailorDBField<WithDBFieldDescription<Defined>, Output>;
type DBFieldRelationFn<Defined extends DefinedDBFieldMetadata, Output> = {
  <S extends RelationType, T extends TailorAnyDBType>(
    config: RelationConfig<S, T>,
  ): TailorDBField<WithDBFieldRelation<Defined, S>, Output>;
  <S extends RelationSelfConfig>(config: S): TailorDBField<WithDBFieldRelation<Defined, S>, Output>;
};
type DBFieldIndexFn<Defined extends DefinedDBFieldMetadata, Output> = () => TailorDBField<
  WithDBFieldIndex<Defined>,
  Output
>;
type DBFieldUniqueFn<Defined extends DefinedDBFieldMetadata, Output> = () => TailorDBField<
  WithDBFieldUnique<Defined>,
  Output
>;
type DBFieldVectorFn<Defined extends DefinedDBFieldMetadata, Output> = () => TailorDBField<
  WithDBFieldVector<Defined>,
  Output
>;
type DBFieldHooksFn<Defined extends DefinedDBFieldMetadata, Output> = <
  const H extends Hook<unknown, Output>,
>(
  hooks: H,
) => TailorDBField<WithDBFieldHooks<Defined, H>, Output>;
type DBFieldValidateFn<Defined extends DefinedDBFieldMetadata, Output> = (
  ...validate: FieldValidateInput<Output>[]
) => TailorDBField<WithDBFieldValidate<Defined>, Output>;
type DBFieldSerialFn<Defined extends DefinedDBFieldMetadata, Output> = (
  config: SerialConfig<Defined["type"] & ("integer" | "string")>,
) => TailorDBField<WithDBFieldSerial<Defined>, Output>;
type DBFieldDescriptionMethod<Defined extends DefinedDBFieldMetadata, Output> =
  IsAny<Defined> extends true
    ? DBFieldDescriptionFn<Defined, Output>
    : Defined extends { description: unknown }
      ? TypeLevelError<".description() has already been set">
      : DBFieldDescriptionFn<Defined, Output>;
type DBFieldRelationMethod<Defined extends DefinedDBFieldMetadata, Output> =
  IsAny<Defined> extends true
    ? DBFieldRelationFn<Defined, Output>
    : Defined extends { relation: unknown }
      ? TypeLevelError<".relation() has already been set">
      : DBFieldRelationFn<Defined, Output>;
type DBFieldIndexMethod<Defined extends DefinedDBFieldMetadata, Output> =
  IsAny<Defined> extends true
    ? DBFieldIndexFn<Defined, Output>
    : Defined extends { index: unknown }
      ? TypeLevelError<".index() has already been set">
      : boolean extends Defined["array"]
        ? DBFieldIndexFn<Defined, Output> | TypeLevelError<"index cannot be set on array fields">
        : Defined extends { array: true }
          ? TypeLevelError<"index cannot be set on array fields">
          : DBFieldIndexFn<Defined, Output>;
type DBFieldUniqueMethod<Defined extends DefinedDBFieldMetadata, Output> =
  IsAny<Defined> extends true
    ? DBFieldUniqueFn<Defined, Output>
    : Defined extends { unique: unknown }
      ? TypeLevelError<".unique() has already been set">
      : boolean extends Defined["array"]
        ? DBFieldUniqueFn<Defined, Output> | TypeLevelError<"unique cannot be set on array fields">
        : Defined extends { array: true }
          ? TypeLevelError<"unique cannot be set on array fields">
          : DBFieldUniqueFn<Defined, Output>;
type DBFieldVectorMethod<Defined extends DefinedDBFieldMetadata, Output> =
  IsAny<Defined> extends true
    ? DBFieldVectorFn<Defined, Output>
    : Defined extends { vector: unknown }
      ? TypeLevelError<".vector() has already been set">
      : Defined extends { type: "string"; array: false }
        ? DBFieldVectorFn<Defined, Output>
        : TypeLevelError<"vector can only be set on non-array string fields">;
type DBFieldHooksMethod<Defined extends DefinedDBFieldMetadata, Output> =
  IsAny<Defined> extends true
    ? DBFieldHooksFn<Defined, Output>
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
          : DBFieldHooksFn<Defined, Output>;
type DBFieldValidateMethod<Defined extends DefinedDBFieldMetadata, Output> =
  IsAny<Defined> extends true
    ? DBFieldValidateFn<Defined, Output>
    : Defined extends { validate: unknown }
      ? TypeLevelError<".validate() has already been set">
      : DBFieldValidateFn<Defined, Output>;
type DBFieldSerialMethod<Defined extends DefinedDBFieldMetadata, Output> =
  IsAny<Defined> extends true
    ? DBFieldSerialFn<Defined, Output>
    : Defined extends { serial: true }
      ? TypeLevelError<".serial() has already been set">
      : Defined extends { serial: false }
        ? TypeLevelError<"serial cannot be set after hooks">
        : IsAny<Output> extends true
          ? Defined extends { type: "integer" | "string"; array: false }
            ? DBFieldSerialFn<Defined, Output>
            : TypeLevelError<"serial can only be set on non-array integer or string fields">
          : null extends Output
            ? TypeLevelError<"serial can only be set on non-array integer or string fields">
            : Defined extends { type: "integer" | "string"; array: false }
              ? DBFieldSerialFn<Defined, Output>
              : TypeLevelError<"serial can only be set on non-array integer or string fields">;
type DBTypeHooksFn<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = {
  hooks(hooks: Hooks<Fields>): TailorDBType<Fields, User, WithDBTypeMetadata<Defined, "hooks">>;
}["hooks"];
type DBTypeValidateFn<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = {
  validate(
    validators: Validators<Fields>,
  ): TailorDBType<Fields, User, WithDBTypeMetadata<Defined, "validate">>;
}["validate"];
type DBTypeFeaturesFn<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = {
  features(
    features: Omit<TypeFeatures, "pluralForm">,
  ): TailorDBType<Fields, User, WithDBTypeMetadata<Defined, "features">>;
}["features"];
type DBTypeIndexesFn<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = {
  indexes(
    ...indexes: IndexDef<TailorDBType<Fields, User, Defined>>[]
  ): TailorDBType<Fields, User, WithDBTypeMetadata<Defined, "indexes">>;
}["indexes"];
type DBTypeFilesFn<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = {
  files<const F extends string>(
    files: Record<F, string> & FileKeyConflictError<Fields, User>,
  ): TailorDBType<Fields, User, WithDBTypeMetadata<Defined, "files">>;
}["files"];
type DBTypePermissionFn<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = {
  permission<
    U extends object = User,
    P extends TailorTypePermission<U, output<TailorDBType<Fields, User, Defined>>> =
      TailorTypePermission<U, output<TailorDBType<Fields, User, Defined>>>,
  >(
    permission: P,
  ): TailorDBType<Fields, U, WithDBTypeMetadata<Defined, "permission">>;
}["permission"];
type DBTypeGqlPermissionFn<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = {
  gqlPermission<
    U extends object = User,
    P extends TailorTypeGqlPermission<U> = TailorTypeGqlPermission<U>,
  >(
    permission: P,
  ): TailorDBType<Fields, U, WithDBTypeMetadata<Defined, "gqlPermission">>;
}["gqlPermission"];
type DBTypeHooksMethod<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = DBTypeDuplicateGuard<
  Defined,
  "hooks",
  DBTypeHooksFn<Fields, User, Defined>,
  ".hooks() has already been set"
>;
type DBTypeValidateMethod<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = DBTypeDuplicateGuard<
  Defined,
  "validate",
  DBTypeValidateFn<Fields, User, Defined>,
  ".validate() has already been set"
>;
type DBTypeFeaturesMethod<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = DBTypeDuplicateGuard<
  Defined,
  "features",
  DBTypeFeaturesFn<Fields, User, Defined>,
  ".features() has already been set"
>;
type DBTypeIndexesMethod<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = DBTypeDuplicateGuard<
  Defined,
  "indexes",
  DBTypeIndexesFn<Fields, User, Defined>,
  ".indexes() has already been set"
>;
type DBTypeFilesMethod<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = DBTypeDuplicateGuard<
  Defined,
  "files",
  DBTypeFilesFn<Fields, User, Defined>,
  ".files() has already been set"
>;
type DBTypePermissionMethod<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = DBTypeDuplicateGuard<
  Defined,
  "permission",
  DBTypePermissionFn<Fields, User, Defined>,
  ".permission() has already been set"
>;
type DBTypeGqlPermissionMethod<
  Fields extends Record<string, TailorAnyDBField>,
  User extends object,
  Defined extends DefinedDBTypeMetadata,
> = DBTypeDuplicateGuard<
  Defined,
  "gqlPermission",
  DBTypeGqlPermissionFn<Fields, User, Defined>,
  ".gqlPermission() has already been set"
>;

/**
 * Full TailorDBField interface with builder methods.
 * Extends the minimal structural interface from types/ with fluent API methods.
 */
export interface TailorDBField<
  Defined extends DefinedDBFieldMetadata = DefinedDBFieldMetadata,
  // oxlint-disable-next-line no-explicit-any
  Output = any,
> extends Omit<TailorDBFieldBase<Defined, Output>, "fields"> {
  readonly fields: Record<string, TailorAnyDBField>;
  _metadata: DBFieldMetadata;

  /**
   * Parse and validate a value against this field's validation rules
   */
  parse(args: FieldParseArgs): StandardSchemaV1.Result<Output>;

  /**
   * Internal parse method that tracks field path for nested validation
   * @private
   */
  _parseInternal(args: FieldParseInternalArgs): StandardSchemaV1.Result<Output>;

  /**
   * typeName is not available on TailorDB fields.
   * Use typeName on pipeline fields (t.enum / t.object) instead.
   */
  typeName: DBFieldTypeNameMethod<Defined>;

  /**
   * Set a description for the field
   */
  description: DBFieldDescriptionMethod<Defined, Output>;

  /**
   * Define a relation to another type.
   */
  relation: DBFieldRelationMethod<Defined, Output>;

  /**
   * Add an index to the field
   */
  index: DBFieldIndexMethod<Defined, Output>;

  /**
   * Make the field unique (also adds an index)
   */
  unique: DBFieldUniqueMethod<Defined, Output>;

  /**
   * Enable vector search on the field (string type only)
   */
  vector: DBFieldVectorMethod<Defined, Output>;

  /**
   * Add hooks for create/update operations on this field.
   */
  hooks: DBFieldHooksMethod<Defined, Output>;

  /**
   * Add validation functions to the field.
   */
  validate: DBFieldValidateMethod<Defined, Output>;

  /**
   * Configure serial/auto-increment behavior
   */
  serial: DBFieldSerialMethod<Defined, Output>;

  /**
   * Clone the field with optional overrides for field options
   */
  clone<const NewOpt extends FieldOptions>(
    options?: NewOpt,
  ): TailorDBField<
    WithDBFieldCloneOptions<Defined, NewOpt>,
    FieldOutput<TailorToTs[Defined["type"]], NewOpt>
  >;
}

/**
 * Full TailorDBType interface with builder methods.
 * Extends the minimal structural interface from types/ with fluent API methods.
 */
export interface TailorDBType<
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributeMap,
  // oxlint-disable-next-line no-explicit-any
  Defined extends DefinedDBTypeMetadata = any,
> extends TailorDBTypeBase<Fields, User> {
  _description?: string;

  hooks: DBTypeHooksMethod<Fields, User, Defined>;
  validate: DBTypeValidateMethod<Fields, User, Defined>;
  features: DBTypeFeaturesMethod<Fields, User, Defined>;
  indexes: DBTypeIndexesMethod<Fields, User, Defined>;
  files: DBTypeFilesMethod<Fields, User, Defined>;
  permission: DBTypePermissionMethod<Fields, User, Defined>;
  gqlPermission: DBTypeGqlPermissionMethod<Fields, User, Defined>;
  description(description: string): TailorDBType<Fields, User, Defined>;
  pickFields<K extends keyof Fields>(keys: K[]): Pick<Fields, K>;
  pickFields<K extends keyof Fields, const Opt extends FieldOptions>(
    keys: K[],
    options: Opt,
  ): {
    [P in K]: Fields[P] extends TailorDBField<infer D, infer _O>
      ? TailorDBField<WithDBFieldCloneOptions<D, Opt>, FieldOutput<TailorToTs[D["type"]], Opt>>
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
  User extends object = InferredAttributeMap,
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
  hooks(hooks: Hook<unknown, Output>): object;
  serial(config: SerialConfig): object;
  clone(options?: FieldOptions): TailorDBFieldRuntime<DefinedDBFieldMetadata, AnyBuilderMethod>;
  parse(args: FieldParseArgs): StandardSchemaV1.Result<Output>;
  _parseInternal(args: FieldParseInternalArgs): StandardSchemaV1.Result<Output>;
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
        user: args.user,
        pathArray: [],
      });
    },

    _parseInternal: parseInternal,

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

    hooks(hooks: Hook<unknown, FieldValue>) {
      return cloneWith({ hooks });
    },

    serial(config: SerialConfig) {
      return cloneWith({ serial: config });
    },

    clone(cloneOptions?: FieldOptions) {
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
 * Format: ISO 8601 "yyyy-MM-ddTHH:mm:ssZ"
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
  const F extends Record<string, TailorAnyDBField> & ExcludeNestedDBFields<F>,
  const Opt extends FieldOptions,
>(fields: F, options?: Opt) {
  return createField("nested", options, fields) as unknown as TailorDBField<
    { type: "nested"; array: Opt extends { array: true } ? true : false },
    FieldOutput<InferFieldsOutput<F>, Opt>
  >;
}

/**
 * Creates a new TailorDBType instance.
 * @param name - Type name
 * @param fields - Field definitions
 * @param options - Type options
 * @param options.pluralForm - Optional plural form
 * @param options.description - Optional description
 * @returns A new TailorDBType
 */
function createTailorDBType<
  // oxlint-disable-next-line no-explicit-any
  const Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributeMap,
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

  if (options.pluralForm) {
    if (name === options.pluralForm) {
      throw new Error(`The name and the plural form must be different. name=${name}`);
    }
    _settings.pluralForm = options.pluralForm;
  }

  const dbType: TailorDBType<Fields, User, AnyBuilderMethod> = {
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
      };
    },

    hooks(hooks: Hooks<Fields>) {
      // `Hooks<Fields>` is strongly typed, but `Object.entries()` loses that information.
      // oxlint-disable-next-line no-explicit-any
      Object.entries(hooks).forEach(([fieldName, fieldHooks]: [string, any]) => {
        const field = this.fields[fieldName];
        if (field === undefined) throw new Error(`field not found: ${fieldName}`);
        (this.fields as Record<string, TailorAnyDBField>)[fieldName] = (
          field as TailorAnyDBField
        ).hooks(fieldHooks);
      });
      return this;
    },

    validate(validators: Validators<Fields>) {
      Object.entries(validators).forEach(([fieldName, fieldValidators]) => {
        const field = this.fields[fieldName] as TailorAnyDBField;

        const validators = fieldValidators as
          | FieldValidateInput<unknown>
          | FieldValidateInput<unknown>[];

        const isValidateConfig = (v: unknown): v is ValidateConfig<unknown> => {
          return Array.isArray(v) && v.length === 2 && typeof v[1] === "string";
        };

        let updatedField: TailorAnyDBField;
        if (Array.isArray(validators)) {
          if (isValidateConfig(validators)) {
            updatedField = field.validate(validators);
          } else {
            updatedField = field.validate(...validators);
          }
        } else {
          updatedField = field.validate(validators);
        }
        (this.fields as Record<string, TailorAnyDBField>)[fieldName] = updatedField;
      });
      return this;
    },

    features(features: Omit<TypeFeatures, "pluralForm">) {
      _settings = {
        ..._settings,
        ...features,
      };
      return this;
    },

    indexes(...indexes: IndexDef<TailorDBType<Fields, User>>[]) {
      _indexes = indexes;
      return this;
    },

    files<const F extends string>(files: Record<F, string> & FileKeyConflictError<Fields, User>) {
      _files = files;
      return this;
    },

    permission<
      U extends object = User,
      P extends TailorTypePermission<U, output<TailorDBType<Fields, User>>> = TailorTypePermission<
        U,
        output<TailorDBType<Fields, User>>
      >,
    >(permission: P) {
      const ret = this as TailorDBType<Fields, U>;
      _permissions.record = permission as RawPermissions["record"];
      return ret;
    },

    gqlPermission<
      U extends object = User,
      P extends TailorTypeGqlPermission<U> = TailorTypeGqlPermission<U>,
    >(permission: P) {
      const ret = this as TailorDBType<Fields, U>;
      _permissions.gql = permission as RawPermissions["gql"];
      return ret;
    },

    description(description: string) {
      _description = description;
      this._description = description;
      return this;
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
type DBType<F extends { id?: never } & Record<string, TailorAnyDBField>> = TailorDBInstance<
  { id: idField } & F,
  InferredAttributeMap,
  DefinedDBTypeMetadata
>;

/**
 * Creates a new database type with the specified fields.
 * An `id` field (UUID) is automatically added to every type.
 * @param name - The name of the type, or a tuple of [name, pluralForm]
 * @param fields - The field definitions for the type
 * @returns A new TailorDBType instance
 * @example
 * export const user = db.type("User", {
 *   name: db.string(),
 *   email: db.string(),
 *   age: db.int({ optional: true }),
 *   role: db.enum(["admin", "member"]),
 *   ...db.fields.timestamps(),
 * });
 * // Always export both the value and type:
 * export type user = typeof user;
 */
function dbType<const F extends { id?: never } & Record<string, TailorAnyDBField>>(
  name: string | [string, string],
  fields: F,
): DBType<F>;
/**
 * Creates a new database type with the specified fields and description.
 * An `id` field (UUID) is automatically added to every type.
 * @param name - The name of the type, or a tuple of [name, pluralForm]
 * @param description - A description of the type
 * @param fields - The field definitions for the type
 * @returns A new TailorDBType instance
 */
function dbType<const F extends { id?: never } & Record<string, TailorAnyDBField>>(
  name: string | [string, string],
  description: string,
  fields: F,
): DBType<F>;
function dbType<const F extends { id?: never } & Record<string, TailorAnyDBField>>(
  name: string | [string, string],
  fieldsOrDescription: string | F,
  fields?: F,
): DBType<F> {
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
  ) as DBType<F>;
}

/** TailorDB schema builder utilities for defining types and fields. */
export const db = {
  type: dbType,
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
     * Creates standard timestamp fields (createdAt, updatedAt) with auto-hooks.
     * createdAt is set on create, updatedAt is set on update.
     * A user-specified createdAt is respected when provided (e.g. seeding historical
     * records); the current time is used only when the value is omitted.
     * @returns An object with createdAt and updatedAt fields
     * @example
     * const model = db.type("Model", {
     *   name: db.string(),
     *   ...db.fields.timestamps(),
     * });
     */
    timestamps: () => ({
      createdAt: datetime()
        .hooks({ create: ({ value }) => value ?? new Date() })
        .description("Record creation timestamp"),
      updatedAt: datetime({ optional: true })
        .hooks({ update: () => new Date() })
        .description("Record last update timestamp"),
    }),
  },
};
