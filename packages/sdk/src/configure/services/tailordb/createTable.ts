import { type AllowedValues, type AllowedValuesOutput } from "@/configure/types/field";
import {
  type TailorAnyDBField,
  type TailorAnyDBType,
  type TailorDBField,
  type TailorDBType,
  createTailorDBField,
  createTailorDBType,
} from "./schema";
import type { TailorTypeGqlPermission, TailorTypePermission } from "./permission";
import type { RecordHook, TypeFeatures } from "./types";
import type { TailorFieldType, TailorToTs } from "@/types/field-types";
import type { InferFieldsOutput, output } from "@/types/helpers";
import type { PluginAttachment } from "@/types/plugin";
import type { IndexDef, RelationType, SerialConfig } from "@/types/tailordb";
import type { InferredAttributeMap } from "@/types/user";
import type { RecordValidators } from "@/types/validation";

type CommonFieldOptions = {
  optional?: boolean;
  description?: string;
  generated?: boolean;
};

const kindToFieldType = {
  string: "string",
  int: "integer",
  float: "float",
  bool: "boolean",
  uuid: "uuid",
  decimal: "decimal",
  date: "date",
  datetime: "datetime",
  time: "time",
  enum: "enum",
  object: "nested",
} as const satisfies Record<string, TailorFieldType>;

type KindToFieldType = typeof kindToFieldType;

type KindToTsType = {
  [K in keyof KindToFieldType as K extends "enum" | "object"
    ? never
    : K]: TailorToTs[KindToFieldType[K]];
};

// Field-level options.
// NOTE: field-level `hooks` and `validate` have been removed. Configure them at
// record level via the third `options` argument of `createTable` instead.
type FieldOptions = {
  unique?: boolean;
  index?: boolean;
};

type StringDescriptor = CommonFieldOptions &
  FieldOptions & {
    kind: "string";
    array?: boolean;
    vector?: boolean;
    serial?: SerialConfig<"string">;
  };

type IntDescriptor = CommonFieldOptions &
  FieldOptions & {
    kind: "int";
    array?: boolean;
    serial?: SerialConfig<"integer">;
  };

type SimpleDescriptor<K extends keyof KindToTsType> = CommonFieldOptions &
  FieldOptions & {
    kind: K;
    array?: boolean;
  };

type FloatDescriptor = SimpleDescriptor<"float">;
type BoolDescriptor = SimpleDescriptor<"bool">;
type DateDescriptor = SimpleDescriptor<"date">;
type DatetimeDescriptor = SimpleDescriptor<"datetime">;
type TimeDescriptor = SimpleDescriptor<"time">;
type DecimalDescriptor = CommonFieldOptions &
  FieldOptions & {
    kind: "decimal";
    array?: boolean;
    scale?: number;
  };

type UuidDescriptor = CommonFieldOptions &
  FieldOptions & {
    kind: "uuid";
    array?: boolean;
    relation?: {
      type: RelationType;
      toward: {
        type: TailorAnyDBType | "self";
        as?: string;
        // Typed as plain `string` here (not `keyof T["fields"]`); validated
        // at the createTable call site via `ValidateRelationKeys<D>`.
        key?: string;
      };
      backward?: string;
    };
  };

type EnumDescriptor<V extends AllowedValues = AllowedValues> = CommonFieldOptions &
  FieldOptions & {
    kind: "enum";
    array?: boolean;
    values: V;
    typeName?: string;
  };

// Nested object sub-fields bypass top-level constraint types (RejectArrayCombinations, etc.)
// because recursive mapped-type constraints would add significant complexity. This is a shared gap
// with the fluent API (db.object() sub-fields are also unconstrained). Invalid nested combinations
// are caught at deployment time by the platform.
type ObjectDescriptor = CommonFieldOptions & {
  kind: "object";
  array?: boolean;
  fields: Record<string, FieldEntry>;
  typeName?: string;
};

type FieldDescriptor =
  | StringDescriptor
  | IntDescriptor
  | FloatDescriptor
  | BoolDescriptor
  | DateDescriptor
  | DatetimeDescriptor
  | TimeDescriptor
  | DecimalDescriptor
  | UuidDescriptor
  | EnumDescriptor
  | ObjectDescriptor;

type FieldEntry = FieldDescriptor | TailorAnyDBField;

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
} & (D extends { unique: true }
  ? { unique: true; index: true }
  : D extends { index: true }
    ? { index: true }
    : unknown) &
  (D extends { serial: object }
    ? { serial: true; hooks: { create: false; update: false } }
    : unknown) &
  (D extends { vector: true } ? { vector: true } : unknown) &
  (D extends { kind: "uuid"; relation: object }
    ? D extends { array: true }
      ? { relation: true }
      : D extends { relation: { type: "oneToOne" | "1-1" } }
        ? { relation: true; unique: true; index: true }
        : { relation: true; index: true }
    : unknown);

type ResolvedField<E extends FieldEntry> = E extends FieldDescriptor
  ? TailorDBField<DescriptorDefined<E>, DescriptorOutput<E>>
  : E;

// oxlint-disable-next-line no-explicit-any
type ResolvedFieldMap<M extends Record<string, FieldEntry>> = {
  [K in keyof M]: ResolvedField<M[K]>;
};

// Rejects nested objects inside object descriptors (matching ExcludeNestedDBFields in fluent API).
type RejectNestedSubFields<F extends Record<string, FieldEntry>> = {
  [K in keyof F]: F[K] extends
    | { kind: "object" }
    // oxlint-disable-next-line no-explicit-any -- loose match for nested TailorDBField
    | TailorDBField<{ type: "nested"; array: boolean }, any>
    ? never
    : F[K];
};

// All descriptor-level validations in a single mapped type to minimize type
// evaluation passes (avoids combinatorial explosion with union descriptors).
type ValidatedDescriptors<D extends Record<string, FieldEntry>> = D & {
  [K in keyof D]: D[K] extends // 1. RejectArrayCombinations: array + index/unique/vector/serial
    | { array: true; unique: true }
    | { array: true; index: true }
    | { array: true; vector: true }
    | { array: true; serial: object }
    ? never
    : // 2. RejectUniqueOnManyRelation: unique only allowed on oneToOne uuid relations
      D[K] extends { kind: "uuid"; unique: true; relation: { type: infer T } }
      ? T extends "oneToOne" | "1-1"
        ? D[K]
        : never
      : // 3. RejectNestedInObject: no nested objects inside object fields
        D[K] extends { kind: "object"; fields: infer F }
        ? F extends Record<string, FieldEntry>
          ? D[K] & { fields: RejectNestedSubFields<F> }
          : D[K]
        : // 4. ValidateRelationKeys: relation key must exist in target type
          D[K] extends { kind: "uuid"; relation: { toward: { type: infer T; key: infer Key } } }
          ? Key extends string
            ? T extends TailorAnyDBType
              ? Key extends (keyof T["fields"] & string) | "id"
                ? D[K]
                : never
              : T extends "self"
                ? Key extends (keyof D & string) | "id"
                  ? D[K]
                  : never
                : D[K]
            : D[K]
          : D[K];
};

type CreateTableOptions<
  FieldNames extends string = string,
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
> = {
  description?: string;
  pluralForm?: string;
  features?: Omit<TypeFeatures, "pluralForm">;
  indexes?: IndexDef<{ fields: Record<FieldNames, unknown> }>[];
  files?: Record<string, string> & Partial<Record<FieldNames, never>>;
  permission?: TailorTypePermission<InferredAttributeMap, output<TailorDBType<Fields>>>;
  gqlPermission?: TailorTypeGqlPermission;
  plugins?: PluginAttachment[];
  /**
   * Record-level create/update hooks. Each callback receives `{ data, user }`
   * (the entire record snapshot) and returns an object with only the fields
   * to override; omitted fields keep their incoming values.
   */
  hooks?: RecordHook<InferFieldsOutput<Fields>>;
  /**
   * Record-level validators. Each callback receives `{ data, user }` and must
   * return `true` for a valid record. Use the tuple form `[fn, message]` for
   * diagnosable error messages.
   */
  validate?: RecordValidators<InferFieldsOutput<Fields>>;
};

function isPassthroughField(entry: FieldEntry): entry is TailorAnyDBField {
  // All FieldDescriptor variants have `kind`; TailorAnyDBField does not.
  return !("kind" in entry);
}

function resolveField(entry: FieldEntry): TailorAnyDBField {
  if (isPassthroughField(entry)) {
    const cast = entry as { type?: unknown; metadata?: unknown };
    if (typeof cast.type !== "string" || typeof cast.metadata !== "object" || !cast.metadata) {
      throw new Error(
        "Expected a field descriptor (with `kind`) or a db.*() field instance (with `type`)",
      );
    }
    return entry;
  }
  return buildField(entry);
}

function resolveFieldMap(entries: Record<string, FieldEntry>): Record<string, TailorAnyDBField> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => [key, resolveField(entry)]),
  );
}

function buildField(descriptor: FieldDescriptor): TailorAnyDBField {
  if (!(descriptor.kind in kindToFieldType)) {
    throw new Error(`Unknown field descriptor kind: "${String(descriptor.kind)}"`);
  }
  const fieldType = kindToFieldType[descriptor.kind];
  const options = {
    ...(descriptor.optional === true && { optional: true as const }),
    ...(descriptor.array === true && { array: true as const }),
  };

  let values: AllowedValues | undefined;
  if (descriptor.kind === "enum") {
    if (!Array.isArray(descriptor.values) || descriptor.values.length === 0) {
      throw new Error('Enum field descriptor requires a non-empty "values" array');
    }
    values = descriptor.values;
  }

  const nestedFields =
    descriptor.kind === "object" ? resolveFieldMap(descriptor.fields) : undefined;

  let field: TailorAnyDBField = createTailorDBField(fieldType, options, nestedFields, values);

  if (descriptor.generated === true) {
    field._metadata.generated = true;
  }

  if (descriptor.description !== undefined) {
    field = field.description(descriptor.description);
  }

  if (
    (descriptor.kind === "enum" || descriptor.kind === "object") &&
    descriptor.typeName !== undefined
  ) {
    // oxlint-disable-next-line no-explicit-any -- typeName() is only present on enum/nested field interfaces
    field = (field as any).typeName(descriptor.typeName);
  }

  // Object descriptors only support description and typeName; skip indexable options.
  if (descriptor.kind === "object") {
    return field;
  }

  const isArray = descriptor.array === true;
  const relation = descriptor.kind === "uuid" ? descriptor.relation : undefined;

  // When a relation is present, the relation handler dictates index/unique flags.
  if (!isArray && !relation) {
    if (descriptor.unique === true) {
      field = field.unique();
    } else if (descriptor.index === true) {
      field = field.index();
    }
  }

  if (!isArray && descriptor.kind === "string" && descriptor.vector === true) {
    field = field.vector();
  }

  if (descriptor.kind === "decimal" && descriptor.scale !== undefined) {
    if (!Number.isInteger(descriptor.scale) || descriptor.scale < 0 || descriptor.scale > 12) {
      throw new Error("scale must be an integer between 0 and 12");
    }
    // oxlint-disable-next-line no-explicit-any -- decimal scale is set via internal metadata
    (field as any)._metadata.scale = descriptor.scale;
  }

  if (
    !isArray &&
    (descriptor.kind === "string" || descriptor.kind === "int") &&
    descriptor.serial !== undefined
  ) {
    field = field.serial(descriptor.serial);
  }

  if (relation) {
    // oxlint-disable-next-line no-explicit-any -- relation() is only present on uuid field interface
    field = (field as any).relation(relation);
    if (!isArray) {
      const relType = relation.type;
      if (relType === "oneToOne" || relType === "1-1") {
        field = field.unique();
      } else {
        field = field.index();
      }
    }
  }

  return field;
}

const idField = createTailorDBField("uuid");
type IdField = typeof idField;

type AllFields<D extends Record<string, FieldEntry>> = { id: IdField } & ResolvedFieldMap<D>;

/**
 * Create a TailorDB type using an object-literal API.
 * @param name - The name of the type, or a tuple of [name, pluralForm]
 * @param descriptors - Field descriptors as an object literal
 * @param options - Optional type-level options (permission, gqlPermission, features, etc.)
 * @returns A new TailorDBType instance
 * @example
 * export const user = createTable("User", {
 *   name: { kind: "string" },
 *   email: { kind: "string", unique: true },
 *   status: { kind: "string", optional: true },
 *   role: { kind: "enum", values: ["MANAGER", "STAFF"] },
 *   ...timestampFields(),
 * });
 * export type user = typeof user;
 */
// Overload 1: FieldDescriptor-only. Narrows the entry constraint so TS infers
// descriptor literals against `FieldDescriptor` rather than the wider
// `FieldEntry` union, which is needed for `options.permission`/`options.hooks`
// callbacks to receive precisely-typed `data` for descriptor-only types.
export function createTable<const D extends { id?: never } & Record<string, FieldDescriptor>>(
  name: string | [string, string],
  descriptors: [D] extends [ValidatedDescriptors<D>] ? D : ValidatedDescriptors<D>,
  options?: CreateTableOptions<keyof AllFields<D> & string, AllFields<D>>,
): TailorDBType<AllFields<D>>;
// Overload 2: mixed FieldDescriptor + TailorAnyDBField (fallback)
export function createTable<const D extends { id?: never } & Record<string, FieldEntry>>(
  name: string | [string, string],
  descriptors: [D] extends [ValidatedDescriptors<D>] ? D : ValidatedDescriptors<D>,
  options?: CreateTableOptions<keyof AllFields<D> & string, AllFields<D>>,
): TailorDBType<AllFields<D>>;
export function createTable<const D extends { id?: never } & Record<string, FieldEntry>>(
  name: string | [string, string],
  descriptors: [D] extends [ValidatedDescriptors<D>] ? D : ValidatedDescriptors<D>,
  options?: CreateTableOptions<keyof AllFields<D> & string, AllFields<D>>,
): TailorDBType<AllFields<D>> {
  if (Array.isArray(name) && options?.pluralForm !== undefined) {
    throw new Error(
      `createTable("${name[0]}"): pluralForm is specified twice (once via the name tuple "${name[1]}" and once via options.pluralForm "${options.pluralForm}"). Pick one.`,
    );
  }
  const [typeName, pluralForm] = Array.isArray(name) ? name : [name, options?.pluralForm];
  const fields = {
    id: idField.clone(),
    ...resolveFieldMap(descriptors),
  } as AllFields<D>;

  const dbType = createTailorDBType(typeName, fields, {
    pluralForm,
    description: options?.description,
  });

  if (options?.features) {
    dbType.features(options.features);
  }
  if (options?.indexes) {
    // oxlint-disable-next-line no-explicit-any -- IndexDef generic param differs structurally from TailorDBType
    dbType.indexes(...(options.indexes as any));
  }
  if (options?.files) {
    // oxlint-disable-next-line no-explicit-any -- files() infers literal key type; pre-validated by CreateTableOptions constraint
    dbType.files(options.files as any);
  }
  if (options?.permission) {
    dbType.permission(options.permission);
  }
  if (options?.gqlPermission) {
    dbType.gqlPermission(options.gqlPermission);
  }
  if (options?.plugins) {
    for (const { pluginId, config } of options.plugins) {
      // oxlint-disable-next-line no-explicit-any -- PluginAttachment.config is unknown; bypass PluginConfigs generic constraint
      dbType.plugin({ [pluginId]: config } as any);
    }
  }
  if (options?.hooks) {
    dbType.hooks(options.hooks);
  }
  if (options?.validate) {
    dbType.validate(options.validate);
  }

  return dbType;
}

/**
 * Returns standard timestamp field descriptors (createdAt, updatedAt).
 * Hooks for auto-populating these timestamps must be configured at the record
 * level via `options.hooks` (see `createTable`).
 * @returns An object with createdAt and updatedAt field descriptors
 * @example
 * const model = createTable(
 *   "Model",
 *   {
 *     name: { kind: "string" },
 *     ...timestampFields(),
 *   },
 *   {
 *     hooks: {
 *       create: () => ({ createdAt: new Date() }),
 *       update: () => ({ updatedAt: new Date() }),
 *     },
 *   },
 * );
 */
export function timestampFields() {
  return {
    createdAt: {
      kind: "datetime",
      description: "Record creation timestamp",
      generated: true,
    },
    updatedAt: {
      kind: "datetime",
      optional: true,
      description: "Record last update timestamp",
      generated: true,
    },
  } as const satisfies Record<string, FieldDescriptor>;
}
