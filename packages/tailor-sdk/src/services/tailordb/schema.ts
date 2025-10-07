import { clone } from "es-toolkit";

import { type OperatorFieldConfig } from "@/types/operator";
import { type TailorDBTypeConfig } from "./operator-types";
import {
  type DBFieldMetadata,
  type DefinedDBFieldMetadata,
  type Hooks,
  type Validators,
  type FieldValidateInput,
  type Hook,
  type ValidateConfig,
  type SerialConfig,
  type IndexDef,
  type TypeFeatures,
  type FieldInput,
  type ExcludeNestedDBFields,
} from "./types";
import {
  type FieldOptions,
  type FieldOutput,
  type InferFieldsOutput,
  type TailorFieldType,
  type TailorToTs,
} from "@/types/types";
import type { Prettify, output } from "@/types/helpers";
import { type AllowedValues, type AllowedValuesOutput } from "@/types/field";
import { TailorField, TailorType } from "@/types/type";
import * as inflection from "inflection";
import {
  type Permissions,
  type TailorTypeGqlPermission,
  type TailorTypePermission,
  normalizePermission,
  normalizeGqlPermission,
} from "./permission";
import { tailorUserMap } from "@/types";

type RelationType =
  | "oneToOne"
  | "1-1"
  | "manyToOne"
  | "n-1"
  | "N-1"
  | "keyOnly";

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
  type: "oneToOne" | "1-1" | "manyToOne" | "n-1" | "N-1" | "keyOnly";
  toward: {
    type: "self";
    as?: string;
    key?: string;
  };
  backward?: string;
};

interface ReferenceConfig<T extends TailorDBType> {
  type: TailorDBType;
  key: keyof T["fields"] & string;
  nameMap: [string, string];
}

export class TailorDBField<
  const Defined extends DefinedDBFieldMetadata,
  const Output,
  Input,
> extends TailorField<Defined, Output, DBFieldMetadata> {
  private _ref: ReferenceConfig<TailorDBType> | undefined = undefined;

  get reference(): Readonly<ReferenceConfig<TailorDBType>> | undefined {
    return clone(this._ref);
  }

  get metadata() {
    return { ...this._metadata };
  }

  get config(): OperatorFieldConfig {
    return {
      ...this._metadata,
      validate: this._metadata.validate?.map((v) => {
        const { fn, message } =
          typeof v === "function"
            ? { fn: v, message: `failed by \`${v.toString().trim()}\`` }
            : { fn: v[0], message: v[1] };

        return {
          script: {
            expr: `(${fn.toString().trim()})({ value: _value, data: _data, user: ${tailorUserMap} })`,
          },
          errorMessage: message,
        };
      }),
      hooks: this._metadata.hooks
        ? {
            create: this._metadata.hooks.create
              ? {
                  expr: `(${this._metadata.hooks.create
                    .toString()
                    .trim()})({ value: _value, data: _data, user: ${tailorUserMap} })`,
                }
              : undefined,
            update: this._metadata.hooks.update
              ? {
                  expr: `(${this._metadata.hooks.update
                    .toString()
                    .trim()})({ value: _value, data: _data, user: ${tailorUserMap} })`,
                }
              : undefined,
          }
        : undefined,
      serial: this._metadata.serial
        ? {
            start: this._metadata.serial.start,
            maxValue: this._metadata.serial.maxValue,
            format:
              "format" in this._metadata.serial
                ? this._metadata.serial.format
                : undefined,
          }
        : undefined,
    };
  }

  private constructor(
    type: TailorFieldType,
    options?: FieldOptions,
    fields?: Record<string, TailorDBField<any, any, any>>,
    values?: AllowedValues,
  ) {
    super(type, options, fields, values);
  }

  static create<
    const T extends TailorFieldType,
    const TOptions extends FieldOptions,
  >(
    type: T,
    options?: TOptions,
    fields?: Record<string, TailorDBField<any, any, any>>,
    values?: AllowedValues,
  ) {
    return new TailorDBField<
      { type: T; array: TOptions extends { array: true } ? true : false },
      FieldOutput<TailorToTs[T], TOptions>,
      FieldInput<TailorToTs[T], TOptions>
    >(type, options, fields, values);
  }

  description<CurrentDefined extends Defined>(
    this: CurrentDefined extends { description: unknown }
      ? never
      : TailorField<CurrentDefined, Output>,
    description: string,
  ): TailorDBField<
    Prettify<CurrentDefined & { description: true }>,
    Output,
    Input
  > {
    return super.description(description) as any;
  }

  relation<
    S extends RelationType,
    T extends TailorDBType,
    CurrentDefined extends Defined,
  >(
    this: CurrentDefined extends { relation: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Input>,
    config: RelationConfig<S, T>,
  ): TailorDBField<
    S extends "oneToOne" | "1-1"
      ? Prettify<CurrentDefined & { unique: true; index: true; relation: true }>
      : Prettify<CurrentDefined & { index: true; relation: true }>,
    Output,
    Input
  >;

  // Overload: self-referencing variant
  relation<
    const Config extends RelationSelfConfig,
    CurrentDefined extends Defined,
  >(
    this: CurrentDefined extends { relation: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Input>,
    config: Config,
  ): TailorDBField<
    Config["type"] extends "oneToOne" | "1-1"
      ? Prettify<CurrentDefined & { unique: true; index: true; relation: true }>
      : Prettify<CurrentDefined & { index: true; relation: true }>,
    Output,
    Input
  >;

  // Implementation
  relation<CurrentDefined extends Defined>(
    this: CurrentDefined extends { relation: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Input>,
    config: RelationConfig<RelationType, TailorDBType> | RelationSelfConfig,
  ): any {
    const result = this as unknown as TailorDBField<any, Output, Input>;
    // Allow special self-referencing config as well (handled at runtime in TailorDBType)
    const isSelf = (config as any)?.toward?.type === "self";

    result._metadata.index = true;
    result._metadata.foreignKey = true;
    result._metadata.unique = ["oneToOne", "1-1"].includes(config.type);

    // Set foreignKeyType for non-self relation as early as possible
    if (!isSelf) {
      const targetTable: TailorDBType = (
        config as RelationConfig<RelationType, TailorDBType>
      )["toward"].type;
      result._metadata.foreignKeyType = targetTable.name;
    }

    if ((config as any).type === "keyOnly") {
      return result as any;
    }

    const key: string = (config as any)?.toward?.key ?? "id";
    const backward: string = (config as any)?.backward ?? "";

    if (isSelf) {
      const selfConfig = config as RelationSelfConfig;
      // Defer resolving the self reference until the type is constructed
      (result as any)._pendingSelfRelation = {
        as: selfConfig.toward.as,
        key,
        backward,
        relationType: selfConfig.type,
      } as const;
      result._metadata.relation = true;
      return result as any;
    }

    const typeConfig = config as RelationConfig<RelationType, TailorDBType>;
    const targetTable: TailorDBType = typeConfig.toward.type;

    const forwardName =
      typeConfig.toward.as ?? inflection.camelize(targetTable.name, true);

    this._ref = {
      type: targetTable,
      nameMap: [forwardName, backward],
      key,
    };

    result._metadata.relation = true;
    return result as any;
  }

  index<CurrentDefined extends Defined>(
    this: CurrentDefined extends { index: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Input>,
  ) {
    this._metadata.index = true;
    return this as TailorDBField<
      Prettify<CurrentDefined & { index: true }>,
      Output,
      Input
    >;
  }

  unique<CurrentDefined extends Defined>(
    this: CurrentDefined extends { unique: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Input>,
  ) {
    this._metadata.unique = true;
    this._metadata.index = true;
    return this as TailorDBField<
      Prettify<CurrentDefined & { unique: true; index: true }>,
      Output,
      Input
    >;
  }

  vector<CurrentDefined extends Defined>(
    this: CurrentDefined extends { vector: unknown }
      ? never
      : CurrentDefined extends { type: "string"; array: false }
        ? TailorDBField<CurrentDefined, Output, Input>
        : never,
  ) {
    this._metadata.vector = true;
    return this as TailorDBField<
      Prettify<CurrentDefined & { vector: true }>,
      Output,
      Input
    >;
  }

  hooks<CurrentDefined extends Defined>(
    this: CurrentDefined extends { hooks: unknown }
      ? never
      : CurrentDefined extends { type: "nested" }
        ? never
        : TailorDBField<CurrentDefined, Output, Input>,
    hooks: Hook<Input, unknown, Output>,
  ) {
    this._metadata.hooks = hooks;
    return this as TailorDBField<
      Prettify<CurrentDefined & { hooks: true }>,
      Output,
      Input
    >;
  }

  validate<CurrentDefined extends Defined>(
    this: CurrentDefined extends { validate: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Input>,
    ...validate: FieldValidateInput<Output>[]
  ) {
    this._metadata.validate = validate;
    return this as TailorDBField<
      Prettify<CurrentDefined & { validate: true }>,
      Output,
      Input
    >;
  }

  serial<CurrentDefined extends Defined>(
    this: CurrentDefined extends { serial: unknown }
      ? never
      : CurrentDefined extends { type: "integer" | "string"; array: false }
        ? TailorDBField<CurrentDefined, Output, Input>
        : never,
    config: SerialConfig<CurrentDefined["type"] & ("integer" | "string")>,
  ) {
    this._metadata.serial = config;
    return this as TailorDBField<
      Prettify<CurrentDefined & { serial: true }>,
      Output,
      Input
    >;
  }
}

const createField = TailorDBField.create;
function uuid<const Opt extends FieldOptions>(options?: Opt) {
  return createField("uuid", options);
}

function string<const Opt extends FieldOptions>(options?: Opt) {
  return createField("string", options);
}

function bool<const Opt extends FieldOptions>(options?: Opt) {
  return createField("boolean", options);
}

function int<const Opt extends FieldOptions>(options?: Opt) {
  return createField("integer", options);
}

function float<const Opt extends FieldOptions>(options?: Opt) {
  return createField("float", options);
}

function date<const Opt extends FieldOptions>(options?: Opt) {
  return createField("date", options);
}

function datetime<const Opt extends FieldOptions>(options?: Opt) {
  return createField("datetime", options);
}

function time<const Opt extends FieldOptions>(options?: Opt) {
  return createField("time", options);
}

function _enum<const V extends AllowedValues>(
  ...values: V
): TailorDBField<
  { type: "enum"; array: false },
  FieldOutput<AllowedValuesOutput<V>, { optional: false; array: false }>,
  FieldInput<AllowedValuesOutput<V>, { optional: false; array: false }>
>;
function _enum<const V extends AllowedValues, const Opt extends FieldOptions>(
  ...args: [...V, Opt]
): TailorDBField<
  { type: "enum"; array: Opt extends { array: true } ? true : false },
  FieldOutput<AllowedValuesOutput<V>, Opt>,
  FieldInput<AllowedValuesOutput<V>, Opt>
>;
function _enum(
  ...args: (AllowedValues[number] | FieldOptions)[]
): TailorDBField<{ type: "enum"; array: boolean }, any, any> {
  let values: AllowedValues;
  let options: FieldOptions | undefined;
  const lastArg = args[args.length - 1];
  if (typeof lastArg === "object" && !("value" in lastArg)) {
    values = args.slice(0, -1) as AllowedValues;
    options = lastArg;
  } else {
    values = args as AllowedValues;
    options = undefined;
  }
  return createField("enum", options, undefined, values);
}

function object<
  const F extends Record<string, TailorDBField<any, any, any>> &
    ExcludeNestedDBFields<F>,
  const Opt extends FieldOptions,
>(fields: F, options?: Opt) {
  return createField("nested", options, fields) as unknown as TailorDBField<
    { type: "nested"; array: Opt extends { array: true } ? true : false },
    FieldOutput<InferFieldsOutput<F>, Opt>,
    FieldInput<InferFieldsOutput<F>, Opt>
  >;
}

export class TailorDBType<
  const Fields extends Record<string, TailorDBField<any, any, any>> = any,
  User extends object = object,
> extends TailorType<Fields> {
  public readonly referenced: Record<string, [TailorDBType, string]> = {};
  private _description: string | undefined;
  private _settings: TypeFeatures = {};
  private _indexes: IndexDef<this>[] = [];
  private _permissions: Permissions = {};
  private _files: Record<string, string> = {};

  constructor(
    public readonly name: string,
    public readonly fields: Fields,
    options: { pluralForm?: string; description?: string },
  ) {
    super(fields);

    this._description = options.description;

    const pluralForm = options.pluralForm || inflection.pluralize(name);
    if (name === pluralForm) {
      throw new Error(
        `The name and the plural form must be different. name=${name}`,
      );
    }
    this._settings.pluralForm = pluralForm;

    // Resolve any pending self-references now that the type is constructed
    Object.entries(this.fields).forEach(([fieldName, field]) => {
      const pending = (field as any)._pendingSelfRelation as
        | { as?: string; key: string; backward: string; relationType?: string }
        | undefined;
      if (pending) {
        const forwardName = pending.as ?? fieldName.replace(/(ID|Id|id)$/u, "");
        // Type conversion for manipulating private _ref.
        (field as unknown as { _ref: ReferenceConfig<TailorDBType> })._ref = {
          type: this,
          nameMap: [forwardName, pending.backward],
          key: pending.key,
        };
        (field as any)._metadata.foreignKeyType = this.name;
      }
    });

    Object.entries(this.fields).forEach(([fieldName, field]) => {
      if (field.reference && field.reference !== undefined) {
        const ref = field.reference;
        if (ref.type) {
          let backwardFieldName = ref.nameMap?.[1]; // Get backward field name from nameMap

          if (!backwardFieldName || backwardFieldName === "") {
            const lowerName = inflection.camelize(this.name, true);
            backwardFieldName = field.metadata?.unique
              ? inflection.singularize(lowerName)
              : inflection.pluralize(lowerName);
          }

          ref.type.referenced[backwardFieldName] = [this, fieldName];
        }
      }
    });
  }

  get metadata(): TailorDBTypeConfig {
    const metadataFields = Object.entries(this.fields).reduce(
      (acc, [key, field]) => {
        acc[key] = field.config;
        return acc;
      },
      {} as Record<string, OperatorFieldConfig>,
    );

    // Convert indexes to the format expected by the manifest
    const indexes: Record<string, { fields: string[]; unique?: boolean }> = {};
    if (this._indexes && this._indexes.length > 0) {
      this._indexes.forEach((index) => {
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
      schema: {
        description: this._description,
        extends: false,
        fields: metadataFields,
        settings: this._settings,
        permissions: this._permissions,
        files: this._files,
        ...(Object.keys(indexes).length > 0 && { indexes }),
      },
    };
  }

  hooks(hooks: Hooks<Fields>) {
    Object.entries(hooks).forEach(([fieldName, fieldHooks]: [string, any]) => {
      (this.fields[fieldName] as any).hooks(fieldHooks);
    });
    return this;
  }

  validate(validators: Validators<Fields>) {
    Object.entries(validators).forEach(([fieldName, fieldValidators]) => {
      const field = this.fields[fieldName] as TailorDBField<any, any, any>;

      const validators = fieldValidators as
        | FieldValidateInput<unknown>
        | FieldValidateInput<unknown>[];

      const isValidateConfig = (v: unknown): v is ValidateConfig<unknown> => {
        return Array.isArray(v) && v.length === 2 && typeof v[1] === "string";
      };

      if (Array.isArray(validators)) {
        if (isValidateConfig(validators)) {
          field.validate(validators);
        } else {
          field.validate(...validators);
        }
      } else {
        field.validate(validators);
      }
    });
    return this;
  }

  features(features: Omit<TypeFeatures, "pluralForm">) {
    this._settings = { ...this._settings, ...features };
    return this;
  }

  indexes(...indexes: IndexDef<this>[]) {
    this._indexes = indexes;
    return this;
  }

  files<const F extends string>(
    files: Record<F, string> & Partial<Record<keyof output<this>, never>>,
  ) {
    this._files = files;
    return this;
  }

  permission<
    U extends object = User,
    P extends TailorTypePermission<U, output<this>> = TailorTypePermission<
      U,
      output<this>
    >,
  >(permission: P) {
    const ret = this as TailorDBType<Fields, U>;
    ret._permissions.record = normalizePermission(permission);
    return ret;
  }

  gqlPermission<
    U extends object = User,
    P extends TailorTypeGqlPermission<U> = TailorTypeGqlPermission<U>,
  >(permission: P) {
    const ret = this as TailorDBType<Fields, U>;
    ret._permissions.gql = normalizeGqlPermission(permission);
    return ret;
  }
}
export type TailorDBInstance<
  Fields extends Record<string, TailorDBField<any, any, any>> = any,
  User extends object = object,
> = InstanceType<typeof TailorDBType<Fields, User>>;

const idField = uuid();
type idField = typeof idField;
type DBType<
  F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
> = TailorDBInstance<{ id: idField } & F>;

/**
 * Creates a new database type with the specified fields
 * @param name - The name of the type, or a tuple of [name, pluralForm]
 * @param fields - The field definitions for the type
 * @returns A new TailorDBType instance
 */
function dbType<
  const F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
>(name: string | [string, string], fields: F): DBType<F>;
/**
 * Creates a new database type with the specified fields and description
 * @param name - The name of the type, or a tuple of [name, pluralForm]
 * @param description - A description of the type
 * @param fields - The field definitions for the type
 * @returns A new TailorDBType instance
 */
function dbType<
  const F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
>(name: string | [string, string], description: string, fields: F): DBType<F>;
function dbType<
  const F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
>(
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
  return new TailorDBType<{ id: idField } & F>(
    typeName,
    {
      id: idField,
      ...fieldDef,
    },
    { pluralForm, description },
  ) as DBType<F>;
}

export const db = {
  type: dbType,
  uuid,
  string,
  bool,
  int,
  float,
  date,
  datetime,
  time,
  enum: _enum,
  object,
  fields: {
    timestamps: () => ({
      createdAt: datetime({ optional: true, assertNonNull: true }).hooks({
        create: () => new Date().toISOString(),
      }),
      updatedAt: datetime({ optional: true }).hooks({
        update: () => new Date().toISOString(),
      }),
    }),
  },
};
