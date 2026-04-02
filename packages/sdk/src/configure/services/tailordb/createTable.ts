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
import type { Hook, Hooks, SerialConfig, IndexDef, TypeFeatures } from "./types";
import type { InferredAttributeMap } from "@/configure/types";
import type { InferFieldsOutput, output } from "@/configure/types/helpers";
import type { TailorFieldType, TailorToTs } from "@/configure/types/types";
import type { FieldValidateInput, ValidateConfig, Validators } from "@/configure/types/validation";
import type { PluginAttachment } from "@/types/plugin";
import type { RelationType } from "@/types/tailordb";

type CommonFieldOptions = {
  optional?: boolean;
  array?: boolean;
  description?: string;
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

// Hook and validate callbacks receive the base scalar type (e.g. `string`, `number`), not the
// final output type adjusted for `optional`/`array`. Computing the exact output type from
// descriptor flags would require a combinatorial explosion of type variants per kind; the fluent
// API achieves this through method chaining instead. Use `db.*()` when precise hook typing matters.
// Note: inline validate lambdas may lose contextual typing due to the TS union
// `FieldValidateInput<O> | FieldValidateInput<O>[]`; hoist the validator if needed.
type IndexableOptions<O = unknown> = {
  unique?: boolean;
  index?: boolean;
  hooks?: Hook<unknown, O>;
  validate?: FieldValidateInput<O> | FieldValidateInput<O>[];
};

type StringDescriptor = CommonFieldOptions &
  IndexableOptions<string> & {
    kind: "string";
    vector?: boolean;
    serial?: SerialConfig<"string">;
  };

type IntDescriptor = CommonFieldOptions &
  IndexableOptions<number> & {
    kind: "int";
    serial?: SerialConfig<"integer">;
  };

type SimpleDescriptor<K extends keyof KindToTsType> = CommonFieldOptions &
  IndexableOptions<KindToTsType[K]> & {
    kind: K;
  };

type FloatDescriptor = SimpleDescriptor<"float">;
type BoolDescriptor = SimpleDescriptor<"bool">;
type DateDescriptor = SimpleDescriptor<"date">;
type DatetimeDescriptor = SimpleDescriptor<"datetime">;
type TimeDescriptor = SimpleDescriptor<"time">;
type DecimalDescriptor = CommonFieldOptions &
  IndexableOptions<string> & {
    kind: "decimal";
    scale?: number;
  };

type UuidDescriptor = CommonFieldOptions &
  IndexableOptions<string> & {
    kind: "uuid";
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
  IndexableOptions<AllowedValuesOutput<V>> & {
    kind: "enum";
    values: V;
    typeName?: string;
  };

// Nested object sub-fields bypass top-level constraint types (RejectArrayCombinations, ValidateHookTypes, etc.)
// because recursive mapped-type constraints would add significant complexity. This is a shared gap
// with the fluent API (db.object() sub-fields are also unconstrained). Invalid nested combinations
// are caught at deployment time by the platform.
type ObjectDescriptor = CommonFieldOptions & {
  kind: "object";
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
} & (D extends { hooks: infer H }
  ? H extends object
    ? {
        hooks: {
          create: H extends { create: unknown } ? true : false;
          update: H extends { update: unknown } ? true : false;
        };
        serial: false;
      }
    : unknown
  : unknown) &
  (D extends { validate: object } ? { validate: true } : unknown) &
  (D extends { unique: true }
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

// Rejects descriptors that combine array: true with index, unique, vector, or serial
// (all unsupported by the platform).
type RejectArrayCombinations<D extends Record<string, FieldEntry>> = {
  [K in keyof D]: D[K] extends
    | { array: true; unique: true }
    | { array: true; index: true }
    | { array: true; vector: true }
    | { array: true; serial: object }
    ? never
    : D[K];
};

// Rejects descriptors that combine hooks and serial (mutually exclusive in fluent API).
// The `kind: string` guard excludes TailorDBField instances whose hooks()/serial() methods extend `object`.
type RejectHooksWithSerial<D extends Record<string, FieldEntry>> = {
  [K in keyof D]: D[K] extends { kind: string; hooks: object; serial: object } ? never : D[K];
};

// Rejects unique: true on non-oneToOne uuid relations (platform rejects unique on n-1 relations).
type RejectUniqueOnManyRelation<D extends Record<string, FieldEntry>> = {
  [K in keyof D]: D[K] extends {
    kind: "uuid";
    unique: true;
    relation: { type: infer T };
  }
    ? T extends "oneToOne" | "1-1"
      ? D[K]
      : never
    : D[K];
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

type RejectNestedInObject<D extends Record<string, FieldEntry>> = {
  [K in keyof D]: D[K] extends { kind: "object"; fields: infer F }
    ? F extends Record<string, FieldEntry>
      ? D[K] & { fields: RejectNestedSubFields<F> }
      : D[K]
    : D[K];
};

// Validates hook return types against the descriptor's base output type (before array/optional)
// at the call site. Uses DescriptorBaseOutput to stay consistent with IndexableOptions, which
// types hooks with the base scalar (see comment above IndexableOptions).
type ValidateHookTypes<D extends Record<string, FieldEntry>> = {
  [K in keyof D]: D[K] extends FieldDescriptor & { hooks: infer H }
    ? H extends Hook<unknown, DescriptorBaseOutput<D[K] & FieldDescriptor>>
      ? D[K]
      : never
    : D[K];
};

// Validates relation key against the target type's fields at the createTable call site.
// Every type implicitly has an `id` field, so `"id"` is always a valid key.
type ValidateRelationKeys<D extends Record<string, FieldEntry>> = {
  [K in keyof D]: D[K] extends {
    kind: "uuid";
    relation: { toward: { type: infer T; key: infer Key } };
  }
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

// Combined constraint: all descriptor-level validations applied at the createTable call site.
type ValidatedDescriptors<D extends Record<string, FieldEntry>> = D &
  RejectArrayCombinations<D> &
  RejectHooksWithSerial<D> &
  RejectUniqueOnManyRelation<D> &
  RejectNestedInObject<D> &
  ValidateHookTypes<D> &
  ValidateRelationKeys<D>;

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
  hooks?: Hooks<Fields>;
  validate?: Validators<Fields>;
};

function isPassthroughField(entry: FieldEntry): entry is TailorAnyDBField {
  // All FieldDescriptor variants have `kind`; TailorAnyDBField does not.
  return !("kind" in entry);
}

function resolveField(entry: FieldEntry): TailorAnyDBField {
  if (isPassthroughField(entry)) {
    if (typeof (entry as { type?: unknown }).type !== "string") {
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

function isValidateConfig(v: unknown): v is ValidateConfig<unknown> {
  return Array.isArray(v) && v.length === 2 && typeof v[1] === "string";
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
  const values = descriptor.kind === "enum" ? descriptor.values : undefined;
  if (descriptor.kind === "enum" && (!Array.isArray(values) || values.length === 0)) {
    throw new Error('Enum field descriptor requires a non-empty "values" array');
  }
  const nestedFields =
    descriptor.kind === "object" ? resolveFieldMap(descriptor.fields) : undefined;

  let field: TailorAnyDBField = createTailorDBField(fieldType, options, nestedFields, values);

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

  // Object descriptors only support description and typeName; skip indexable/hookable options.
  if (descriptor.kind === "object") {
    return field;
  }

  // When a relation is present, the relation handler dictates index/unique flags.
  if (
    descriptor.array !== true &&
    !(descriptor.kind === "uuid" && descriptor.relation !== undefined)
  ) {
    if (descriptor.unique === true) {
      field = field.unique();
    } else if (descriptor.index === true) {
      field = field.index();
    }
  }

  if (descriptor.hooks !== undefined) {
    // oxlint-disable-next-line no-explicit-any -- union of typed Hook<unknown, O> variants narrows to specific O; widen to any for TailorAnyDBField
    field = field.hooks(descriptor.hooks as any);
  }

  if (descriptor.validate !== undefined) {
    if (Array.isArray(descriptor.validate) && !isValidateConfig(descriptor.validate)) {
      // oxlint-disable-next-line no-explicit-any -- union of typed FieldValidateInput<O> variants; widen to any for TailorAnyDBField
      field = field.validate(...(descriptor.validate as any));
    } else {
      // oxlint-disable-next-line no-explicit-any -- union of typed FieldValidateInput<O> variants; widen to any for TailorAnyDBField
      field = field.validate(descriptor.validate as any);
    }
  }

  if (descriptor.kind === "string" && descriptor.vector === true && descriptor.array !== true) {
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
    (descriptor.kind === "string" || descriptor.kind === "int") &&
    descriptor.serial !== undefined &&
    descriptor.array !== true
  ) {
    field = field.serial(descriptor.serial);
  }

  if (descriptor.kind === "uuid" && descriptor.relation !== undefined) {
    // oxlint-disable-next-line no-explicit-any -- relation() is only present on uuid field interface
    field = (field as any).relation(descriptor.relation);
    if (descriptor.array !== true) {
      const relType = descriptor.relation.type;
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
export function createTable<const D extends { id?: never } & Record<string, FieldEntry>>(
  name: string | [string, string],
  descriptors: [D] extends [ValidatedDescriptors<D>] ? D : ValidatedDescriptors<D>,
  options?: CreateTableOptions<keyof AllFields<D> & string, AllFields<D>>,
): TailorDBType<AllFields<D>> {
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
 * Returns standard timestamp fields (createdAt, updatedAt) with auto-hooks.
 * createdAt is set on create, updatedAt is set on update.
 * @returns An object with createdAt and updatedAt field descriptors
 * @example
 * const model = createTable("Model", {
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
