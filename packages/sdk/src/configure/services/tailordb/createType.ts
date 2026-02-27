import { cloneDeep } from "es-toolkit";
import {
  type AllowedValues,
  type AllowedValuesOutput,
  mapAllowedValues,
} from "@/configure/types/field";
import { brandValue } from "@/utils/brand";
import type { TailorTypeGqlPermission, TailorTypePermission } from "./permission";
import type { TailorAnyDBField, TailorAnyDBType, TailorDBField, TailorDBType } from "./schema";
import type { DBFieldMetadata, Hook, Hooks, SerialConfig, IndexDef, TypeFeatures } from "./types";
import type { InferredAttributeMap, TailorUser } from "@/configure/types";
import type { output, InferFieldsOutput } from "@/configure/types/helpers";
import type { TailorAnyField } from "@/configure/types/type";
import type { FieldOptions, TailorFieldType } from "@/configure/types/types";
import type { FieldValidateInput, ValidateConfig, Validators } from "@/configure/types/validation";
import type { PluginAttachment, PluginConfigs } from "@/parser/plugin-config/types";
import type {
  TailorDBTypeMetadata,
  RawPermissions,
  RawRelationConfig,
  RelationType,
} from "@/parser/service/tailordb/types";
import type { StandardSchemaV1 } from "@standard-schema/spec";

// ============================================================================
// Field Descriptor Types
// ============================================================================

type CommonFieldOptions = {
  optional?: boolean;
  array?: boolean;
  description?: string;
  typeName?: string;
};

type IndexableOptions = {
  unique?: boolean;
  index?: boolean;
  hooks?: Hook<unknown, unknown>;
  validate?: FieldValidateInput<unknown> | FieldValidateInput<unknown>[];
};

type StringDescriptor = CommonFieldOptions &
  IndexableOptions & {
    kind: "string";
    vector?: boolean;
    serial?: SerialConfig<"string">;
  };

type IntDescriptor = CommonFieldOptions &
  IndexableOptions & {
    kind: "int";
    serial?: SerialConfig<"integer">;
  };

type FloatDescriptor = CommonFieldOptions &
  IndexableOptions & {
    kind: "float";
  };

type BoolDescriptor = CommonFieldOptions &
  IndexableOptions & {
    kind: "bool";
  };

type DateDescriptor = CommonFieldOptions &
  IndexableOptions & {
    kind: "date";
  };

type DatetimeDescriptor = CommonFieldOptions &
  IndexableOptions & {
    kind: "datetime";
  };

type TimeDescriptor = CommonFieldOptions &
  IndexableOptions & {
    kind: "time";
  };

type UuidDescriptor = CommonFieldOptions &
  IndexableOptions & {
    kind: "uuid";
    relation?: {
      type: RelationType;
      toward: {
        type: TailorAnyDBType | "self";
        as?: string;
        key?: string;
      };
      backward?: string;
    };
  };

type EnumDescriptor<V extends AllowedValues = AllowedValues> = CommonFieldOptions &
  IndexableOptions & {
    kind: "enum";
    values: V;
  };

type ObjectDescriptor = CommonFieldOptions & {
  kind: "object";
  fields: Record<string, FieldEntry>;
};

type FieldDescriptor =
  | StringDescriptor
  | IntDescriptor
  | FloatDescriptor
  | BoolDescriptor
  | DateDescriptor
  | DatetimeDescriptor
  | TimeDescriptor
  | UuidDescriptor
  | EnumDescriptor
  | ObjectDescriptor;

// A field entry is either a descriptor or a passthrough TailorAnyDBField
type FieldEntry = FieldDescriptor | TailorAnyDBField;

// ============================================================================
// Kind → TailorFieldType mapping
// ============================================================================

const kindToFieldType = {
  string: "string",
  int: "integer",
  float: "float",
  bool: "boolean",
  uuid: "uuid",
  date: "date",
  datetime: "datetime",
  time: "time",
  enum: "enum",
  object: "nested",
} as const satisfies Record<string, TailorFieldType>;

type KindToFieldType = typeof kindToFieldType;

// ============================================================================
// Type-Level Output Inference
// ============================================================================

type KindToTsType = {
  string: string;
  int: number;
  float: number;
  bool: boolean;
  uuid: string;
  date: string;
  datetime: string | Date;
  time: string;
};

type DescriptorBaseOutput<D extends FieldDescriptor> = D extends { kind: "enum"; values: infer V }
  ? V extends AllowedValues
    ? AllowedValuesOutput<V>
    : string
  : D extends { kind: "object"; fields: infer F }
    ? F extends Record<string, FieldEntry>
      ? InferFieldsOutput<ResolvedFieldMap<F>>
      : Record<string, unknown>
    : D["kind"] extends keyof KindToTsType
      ? KindToTsType[D["kind"]]
      : unknown;

type ApplyArrayAndOptional<T, D extends FieldDescriptor> = D extends { array: true }
  ? D extends { optional: true }
    ? T[] | null
    : T[]
  : D extends { optional: true }
    ? T | null
    : T;

type DescriptorOutput<D extends FieldDescriptor> = ApplyArrayAndOptional<
  DescriptorBaseOutput<D>,
  D
>;

type DescriptorDefined<D extends FieldDescriptor> = {
  type: D["kind"] extends keyof KindToFieldType ? KindToFieldType[D["kind"]] : TailorFieldType;
  array: D extends { array: true } ? true : false;
};

type ResolvedField<E extends FieldEntry> = E extends FieldDescriptor
  ? TailorDBField<DescriptorDefined<E>, DescriptorOutput<E>>
  : E;

// oxlint-disable-next-line no-explicit-any
type ResolvedFieldMap<M extends Record<string, FieldEntry>> = {
  [K in keyof M]: ResolvedField<M[K]>;
};

// ============================================================================
// CreateType Options
// ============================================================================

type CreateTypeOptions = {
  description?: string;
  pluralForm?: string;
  features?: Omit<TypeFeatures, "pluralForm">;
  indexes?: IndexDef<{ fields: Record<string, unknown> }>[];
  files?: Record<string, string>;
  permission?: TailorTypePermission;
  gqlPermission?: TailorTypeGqlPermission;
};

// ============================================================================
// Regex for parsing
// ============================================================================

const regex = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/,
  time: /^(?<hour>\d{2}):(?<minute>\d{2})$/,
  datetime:
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(.(?<millisec>\d{3}))?Z$/,
} as const;

// ============================================================================
// Detect passthrough TailorAnyDBField
// ============================================================================

function isPassthroughField(entry: FieldEntry): entry is TailorAnyDBField {
  return (
    "_metadata" in entry &&
    "type" in entry &&
    typeof (entry as TailorAnyDBField).clone === "function"
  );
}

// ============================================================================
// buildField: Construct a parser-compatible field object from a descriptor
// ============================================================================

function buildField(descriptor: FieldDescriptor): TailorAnyDBField {
  const fieldType = kindToFieldType[descriptor.kind];

  const _metadata: DBFieldMetadata = {
    required: descriptor.optional !== true,
  };

  if (descriptor.array === true) {
    _metadata.array = true;
  }

  if (descriptor.description !== undefined) {
    _metadata.description = descriptor.description;
  }

  if (descriptor.typeName !== undefined) {
    _metadata.typeName = descriptor.typeName;
  }

  // Indexable options
  if (descriptor.kind !== "object") {
    const d = descriptor as FieldDescriptor & IndexableOptions;
    if (d.unique === true) {
      _metadata.unique = true;
      _metadata.index = true;
    } else if (d.index === true) {
      _metadata.index = true;
    }

    if (d.hooks !== undefined) {
      _metadata.hooks = d.hooks;
    }

    if (d.validate !== undefined) {
      const isValidateConfig = (v: unknown): v is ValidateConfig<unknown> =>
        Array.isArray(v) && v.length === 2 && typeof v[1] === "string";

      if (Array.isArray(d.validate) && !isValidateConfig(d.validate)) {
        _metadata.validate = d.validate;
      } else {
        _metadata.validate = [d.validate];
      }
    }
  }

  // Kind-specific options
  if (descriptor.kind === "string" && descriptor.vector === true) {
    _metadata.vector = true;
  }

  if (
    (descriptor.kind === "string" || descriptor.kind === "int") &&
    descriptor.serial !== undefined
  ) {
    _metadata.serial = descriptor.serial;
  }

  // Enum values
  if (descriptor.kind === "enum") {
    _metadata.allowedValues = mapAllowedValues(descriptor.values);
  }

  // Build nested fields
  const nestedFields: Record<string, TailorAnyDBField> = {};
  if (descriptor.kind === "object") {
    for (const [key, entry] of Object.entries(descriptor.fields)) {
      if (isPassthroughField(entry)) {
        nestedFields[key] = entry;
      } else {
        nestedFields[key] = buildField(entry as FieldDescriptor);
      }
    }
  }

  // Raw relation
  let _rawRelation: RawRelationConfig | undefined;
  if (descriptor.kind === "uuid" && descriptor.relation !== undefined) {
    const rel = descriptor.relation;
    const targetType =
      rel.toward.type === "self" ? "self" : (rel.toward.type as TailorAnyDBType).name;
    _rawRelation = {
      type: rel.type,
      toward: {
        type: targetType,
        as: rel.toward.as,
        key: rel.toward.key,
      },
      backward: rel.backward,
    };
    _metadata.index = true;
    if (rel.type === "oneToOne" || rel.type === "1-1") {
      _metadata.unique = true;
    }
  }

  // Validation helpers
  function validateValue(args: {
    value: unknown;
    data: unknown;
    user: TailorUser;
    pathArray: string[];
  }): StandardSchemaV1.Issue[] {
    const { value, data, user, pathArray } = args;
    const issues: StandardSchemaV1.Issue[] = [];

    switch (fieldType) {
      case "string":
        if (typeof value !== "string") {
          issues.push({
            message: `Expected a string: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;
      case "integer":
        if (typeof value !== "number" || !Number.isInteger(value)) {
          issues.push({
            message: `Expected an integer: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;
      case "float":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          issues.push({
            message: `Expected a number: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          issues.push({
            message: `Expected a boolean: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;
      case "uuid":
        if (typeof value !== "string" || !regex.uuid.test(value)) {
          issues.push({
            message: `Expected a valid UUID: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;
      case "date":
        if (typeof value !== "string" || !regex.date.test(value)) {
          issues.push({
            message: `Expected to match "yyyy-MM-dd" format: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;
      case "datetime":
        if (typeof value !== "string" || !regex.datetime.test(value)) {
          issues.push({
            message: `Expected to match ISO format: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;
      case "time":
        if (typeof value !== "string" || !regex.time.test(value)) {
          issues.push({
            message: `Expected to match "HH:mm" format: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;
      case "enum":
        if (field._metadata.allowedValues) {
          const allowed = field._metadata.allowedValues.map((v) => v.value);
          if (typeof value !== "string" || !allowed.includes(value)) {
            issues.push({
              message: `Must be one of [${allowed.join(", ")}]: received ${String(value)}`,
              path: pathArray.length > 0 ? pathArray : undefined,
            });
          }
        }
        break;
      case "nested":
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value) ||
          value instanceof Date
        ) {
          issues.push({
            message: `Expected an object: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        } else if (field.fields && Object.keys(field.fields).length > 0) {
          for (const [fieldName, nestedField] of Object.entries(field.fields)) {
            const fieldValue = (value as Record<string, unknown>)?.[fieldName];
            const result = nestedField._parseInternal({
              value: fieldValue,
              data,
              user,
              pathArray: pathArray.concat(fieldName),
            });
            if (result.issues) {
              issues.push(...result.issues);
            }
          }
        }
        break;
    }

    // Custom validation
    const validateFns = field._metadata.validate;
    if (validateFns && validateFns.length > 0) {
      for (const validateInput of validateFns) {
        const { fn, message } =
          typeof validateInput === "function"
            ? { fn: validateInput, message: "Validation failed" }
            : { fn: validateInput[0], message: validateInput[1] };
        if (!fn({ value, data, user })) {
          issues.push({
            message,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
      }
    }

    return issues;
  }

  function parseInternal(args: {
    // oxlint-disable-next-line no-explicit-any
    value: any;
    data: unknown;
    user: TailorUser;
    pathArray: string[];
    // oxlint-disable-next-line no-explicit-any
  }): StandardSchemaV1.Result<any> {
    const { value, data, user, pathArray } = args;
    const issues: StandardSchemaV1.Issue[] = [];

    const isNullOrUndefined = value === null || value === undefined;
    if (field._metadata.required && isNullOrUndefined) {
      issues.push({
        message: "Required field is missing",
        path: pathArray.length > 0 ? pathArray : undefined,
      });
      return { issues };
    }

    if (!field._metadata.required && isNullOrUndefined) {
      return { value: value ?? null };
    }

    if (field._metadata.array) {
      if (!Array.isArray(value)) {
        issues.push({
          message: "Expected an array",
          path: pathArray.length > 0 ? pathArray : undefined,
        });
        return { issues };
      }
      for (let i = 0; i < value.length; i++) {
        const elementIssues = validateValue({
          value: value[i],
          data,
          user,
          pathArray: pathArray.concat(`[${i}]`),
        });
        if (elementIssues.length > 0) {
          issues.push(...elementIssues);
        }
      }
      if (issues.length > 0) {
        return { issues };
      }
      return { value };
    }

    const valueIssues = validateValue({ value, data, user, pathArray });
    issues.push(...valueIssues);

    if (issues.length > 0) {
      return { issues };
    }
    return { value };
  }

  function cloneWith(metadataUpdates: Partial<DBFieldMetadata>): TailorAnyDBField {
    const cloned = field.clone();
    Object.assign(cloned._metadata, metadataUpdates);
    return cloned;
  }

  const field: TailorAnyDBField = {
    type: fieldType,
    fields: nestedFields as Record<string, TailorAnyField>,
    _defined: undefined as unknown as { type: TailorFieldType; array: boolean },
    _output: undefined,
    _metadata,

    get metadata() {
      return { ...this._metadata };
    },

    get rawRelation(): Readonly<RawRelationConfig> | undefined {
      return _rawRelation ? { ..._rawRelation, toward: { ..._rawRelation.toward } } : undefined;
    },

    description(description: string) {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ description }) as any;
    },

    typeName(typeName: string) {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ typeName }) as any;
    },

    validate(...validateInputs: FieldValidateInput<unknown>[]) {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ validate: validateInputs }) as any;
    },

    parse(args: { value: unknown; data: unknown; user: TailorUser }) {
      return parseInternal({
        value: args.value,
        data: args.data,
        user: args.user,
        pathArray: [],
      });
    },

    _parseInternal: parseInternal,

    relation(
      // oxlint-disable-next-line no-explicit-any
      config: any,
    ) {
      const cloned = field.clone();
      const targetType = config.toward.type === "self" ? "self" : config.toward.type.name;
      // oxlint-disable-next-line no-explicit-any
      (cloned as any)._setRawRelation({
        type: config.type,
        toward: {
          type: targetType,
          as: config.toward.as,
          key: config.toward.key,
        },
        backward: config.backward,
      });
      // oxlint-disable-next-line no-explicit-any
      return cloned as any;
    },

    index() {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ index: true }) as any;
    },

    unique() {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ unique: true, index: true }) as any;
    },

    vector() {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ vector: true }) as any;
    },

    hooks(hooks: Hook<unknown, unknown>) {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ hooks }) as any;
    },

    serial(config: SerialConfig) {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ serial: config }) as any;
    },

    clone(cloneOptions?: FieldOptions) {
      // Deep clone nested object fields if present
      let clonedFields = nestedFields;
      if (Object.keys(nestedFields).length > 0) {
        const cloned: Record<string, TailorAnyDBField> = {};
        for (const [key, f] of Object.entries(nestedFields)) {
          cloned[key] = f.clone();
        }
        clonedFields = cloned;
      }

      const clonedField = buildField({
        kind: descriptor.kind,
        optional: descriptor.optional,
        array: descriptor.array,
        // oxlint-disable-next-line no-explicit-any
      } as any);

      // Reassign nested fields
      // oxlint-disable-next-line no-explicit-any
      (clonedField as any).fields = clonedFields as Record<string, TailorAnyField>;

      // Deep copy metadata (preserves function references)
      Object.assign(clonedField._metadata, cloneDeep(this._metadata));

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
        const clonedRawRelation = cloneDeep(_rawRelation);
        // oxlint-disable-next-line no-explicit-any
        (clonedField as any)._setRawRelation(clonedRawRelation);
      }

      // oxlint-disable-next-line no-explicit-any
      return clonedField as any;
    },

    // @ts-ignore -- Internal method not in interface
    _setRawRelation(relation: RawRelationConfig) {
      _rawRelation = relation;
    },
  };

  return field;
}

// ============================================================================
// buildType: Construct a parser-compatible type object
// ============================================================================

function buildType<Fields extends Record<string, TailorAnyDBField>>(
  name: string,
  fields: Fields,
  options: { pluralForm?: string; description?: string },
): TailorDBType<Fields> {
  let _description = options.description;
  let _settings: TypeFeatures = {};
  let _indexes: IndexDef<TailorDBType<Fields>>[] = [];
  const _permissions: RawPermissions = {};
  let _files: Record<string, string> = {};
  const _plugins: PluginAttachment[] = [];

  if (options.pluralForm) {
    if (name === options.pluralForm) {
      throw new Error(`The name and the plural form must be different. name=${name}`);
    }
    _settings.pluralForm = options.pluralForm;
  }

  const dbType: TailorDBType<Fields> = {
    name,
    fields: { ...fields },
    _output: null as unknown as InferFieldsOutput<Fields>,
    _description,

    get metadata(): TailorDBTypeMetadata {
      const indexes: Record<string, { fields: string[]; unique?: boolean }> = {};
      if (_indexes && _indexes.length > 0) {
        _indexes.forEach((index) => {
          const fieldNames = index.fields.map((f) => String(f));
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
      // oxlint-disable-next-line no-explicit-any
      Object.entries(hooks).forEach(([fieldName, fieldHooks]: [string, any]) => {
        (this.fields as Record<string, TailorAnyDBField>)[fieldName] =
          this.fields[fieldName].hooks(fieldHooks);
      });
      return this;
    },

    validate(validators: Validators<Fields>) {
      Object.entries(validators).forEach(([fieldName, fieldValidators]) => {
        const f = this.fields[fieldName] as TailorAnyDBField;

        const vals = fieldValidators as FieldValidateInput<unknown> | FieldValidateInput<unknown>[];

        const isValidateConfig = (v: unknown): v is ValidateConfig<unknown> => {
          return Array.isArray(v) && v.length === 2 && typeof v[1] === "string";
        };

        let updatedField: TailorAnyDBField;
        if (Array.isArray(vals)) {
          if (isValidateConfig(vals)) {
            updatedField = f.validate(vals);
          } else {
            updatedField = f.validate(...vals);
          }
        } else {
          updatedField = f.validate(vals);
        }
        (this.fields as Record<string, TailorAnyDBField>)[fieldName] = updatedField;
      });
      return this;
    },

    features(features: Omit<TypeFeatures, "pluralForm">) {
      _settings = { ..._settings, ...features };
      return this;
    },

    indexes(...indexes: IndexDef<TailorDBType<Fields>>[]) {
      _indexes = indexes;
      return this;
    },

    files<const F extends string>(
      files: Record<F, string> & Partial<Record<keyof output<TailorDBType<Fields>>, never>>,
    ) {
      _files = files;
      return this;
    },

    permission<
      U extends object = InferredAttributeMap,
      P extends TailorTypePermission<U, output<TailorDBType<Fields>>> = TailorTypePermission<
        U,
        output<TailorDBType<Fields>>
      >,
    >(permission: P) {
      const ret = this as TailorDBType<Fields, U>;
      _permissions.record = permission as RawPermissions["record"];
      return ret;
    },

    gqlPermission<
      U extends object = InferredAttributeMap,
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

    pickFields<K extends keyof Fields, const Opt extends FieldOptions>(keys: K[], options: Opt) {
      const result = {} as Record<K, TailorAnyDBField>;
      for (const key of keys) {
        if (options) {
          result[key] = this.fields[key].clone(options);
        } else {
          result[key] = this.fields[key];
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
          result[key] = this.fields[key];
        }
      }
      return result as Omit<Fields, K>;
    },

    get plugins(): PluginAttachment[] {
      return _plugins;
    },

    plugin<P extends keyof PluginConfigs<keyof Fields & string>>(config: {
      [K in P]: PluginConfigs<keyof Fields & string>[K];
    }): TailorDBType<Fields> {
      for (const [pluginId, pluginConfig] of Object.entries(config)) {
        _plugins.push({ pluginId, config: pluginConfig });
      }
      return this;
    },
  };

  return brandValue(dbType);
}

// ============================================================================
// createType: Main public API
// ============================================================================

// Build the id field used for all types.
// Explicit type annotation ensures output<IdField> = string (same as schema.ts uuid()).
const idField: TailorDBField<{ type: "uuid"; array: false }, string> = buildField({
  kind: "uuid",
  // oxlint-disable-next-line no-explicit-any
}) as any;
type IdField = typeof idField;

/**
 * Create a TailorDB type using an object-literal API.
 * An `id` field (UUID) is automatically added to every type.
 * @param name - The name of the type, or a tuple of [name, pluralForm]
 * @param descriptors - Field descriptors as an object literal
 * @param options - Optional type-level options (permission, gqlPermission, features, etc.)
 * @returns A new TailorDBType instance
 * @example
 * export const user = createType("User", {
 *   name: { kind: "string" },
 *   email: { kind: "string", unique: true },
 *   status: { kind: "string", optional: true },
 *   role: { kind: "enum", values: ["MANAGER", "STAFF"] },
 *   ...timestampFields(),
 * });
 * export type user = typeof user;
 */
export function createType<const D extends Record<string, FieldEntry> & { id?: never }>(
  name: string | [string, string],
  descriptors: D,
  options?: CreateTypeOptions,
): TailorDBType<{ id: IdField } & ResolvedFieldMap<D>> {
  const typeName = Array.isArray(name) ? name[0] : name;
  const pluralForm = Array.isArray(name) ? name[1] : options?.pluralForm;

  // Convert descriptors to fields
  const fields: Record<string, TailorAnyDBField> = {};
  for (const [key, entry] of Object.entries(descriptors)) {
    if (isPassthroughField(entry)) {
      fields[key] = entry;
    } else {
      fields[key] = buildField(entry as FieldDescriptor);
    }
  }

  // Add id field
  const allFields = { id: idField, ...fields } as { id: IdField } & ResolvedFieldMap<D>;

  // Build the type
  const dbType = buildType(typeName, allFields, {
    pluralForm,
    description: options?.description,
  });

  // Apply type-level options
  if (options?.features) {
    dbType.features(options.features);
  }
  if (options?.indexes) {
    // oxlint-disable-next-line no-explicit-any
    dbType.indexes(...(options.indexes as any));
  }
  if (options?.files) {
    // oxlint-disable-next-line no-explicit-any
    dbType.files(options.files as any);
  }
  if (options?.permission) {
    dbType.permission(options.permission);
  }
  if (options?.gqlPermission) {
    dbType.gqlPermission(options.gqlPermission);
  }

  return dbType;
}

// ============================================================================
// timestampFields: Convenience helper
// ============================================================================

/**
 * Returns standard timestamp fields (createdAt, updatedAt) with auto-hooks.
 * createdAt is set on create, updatedAt is set on update.
 * @returns An object with createdAt and updatedAt field descriptors
 * @example
 * const model = createType("Model", {
 *   name: { kind: "string" },
 *   ...timestampFields(),
 * });
 */
export function timestampFields() {
  return {
    createdAt: {
      kind: "datetime",
      hooks: { create: () => new Date() },
      description: "Record creation timestamp",
    },
    updatedAt: {
      kind: "datetime",
      optional: true,
      hooks: { update: () => new Date() },
      description: "Record last update timestamp",
    },
  } as const satisfies Record<string, FieldDescriptor>;
}
