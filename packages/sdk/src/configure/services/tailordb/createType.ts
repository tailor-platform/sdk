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
import type { Hook, SerialConfig, IndexDef, TypeFeatures } from "./types";
import type { InferFieldsOutput } from "@/configure/types/helpers";
import type { TailorFieldType, TailorToTs } from "@/configure/types/types";
import type { FieldValidateInput, ValidateConfig } from "@/configure/types/validation";
import type { RelationType } from "@/parser/service/tailordb/types";

type CommonFieldOptions = {
  optional?: boolean;
  array?: boolean;
  description?: string;
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

type SimpleDescriptor<K extends string> = CommonFieldOptions &
  IndexableOptions & {
    kind: K;
  };

type FloatDescriptor = SimpleDescriptor<"float">;
type BoolDescriptor = SimpleDescriptor<"bool">;
type DateDescriptor = SimpleDescriptor<"date">;
type DatetimeDescriptor = SimpleDescriptor<"datetime">;
type TimeDescriptor = SimpleDescriptor<"time">;

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
    typeName?: string;
  };

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
  | UuidDescriptor
  | EnumDescriptor
  | ObjectDescriptor;

type FieldEntry = FieldDescriptor | TailorAnyDBField;

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

type KindToTsType = {
  [K in keyof KindToFieldType as K extends "enum" | "object"
    ? never
    : K]: TailorToTs[KindToFieldType[K]];
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

type CreateTypeOptions = {
  description?: string;
  pluralForm?: string;
  features?: Omit<TypeFeatures, "pluralForm">;
  indexes?: IndexDef<{ fields: Record<string, unknown> }>[];
  files?: Record<string, string>;
  permission?: TailorTypePermission;
  gqlPermission?: TailorTypeGqlPermission;
};

function isPassthroughField(entry: FieldEntry): entry is TailorAnyDBField {
  return (
    "_metadata" in entry &&
    "type" in entry &&
    typeof (entry as TailorAnyDBField).clone === "function"
  );
}

function resolveField(entry: FieldEntry): TailorAnyDBField {
  if (isPassthroughField(entry)) {
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
  const fieldType = kindToFieldType[descriptor.kind];
  const options = {
    ...(descriptor.optional === true && { optional: true as const }),
    ...(descriptor.array === true && { array: true as const }),
  };
  const values = descriptor.kind === "enum" ? descriptor.values : undefined;
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

  if (descriptor.kind !== "object") {
    if (descriptor.unique === true) {
      field = field.unique();
    } else if (descriptor.index === true) {
      field = field.index();
    }

    if (descriptor.hooks !== undefined) {
      field = field.hooks(descriptor.hooks);
    }

    if (descriptor.validate !== undefined) {
      if (Array.isArray(descriptor.validate) && !isValidateConfig(descriptor.validate)) {
        field = field.validate(...descriptor.validate);
      } else {
        field = field.validate(descriptor.validate);
      }
    }
  }

  if (descriptor.kind === "string" && descriptor.vector === true) {
    field = field.vector();
  }

  if (
    (descriptor.kind === "string" || descriptor.kind === "int") &&
    descriptor.serial !== undefined
  ) {
    field = field.serial(descriptor.serial);
  }

  if (descriptor.kind === "uuid" && descriptor.relation !== undefined) {
    // oxlint-disable-next-line no-explicit-any -- relation() is only present on uuid field interface
    field = (field as any).relation(descriptor.relation);
    const relType = descriptor.relation.type;
    if (relType === "oneToOne" || relType === "1-1") {
      field = field.unique();
    } else {
      field = field.index();
    }
  }

  return field;
}

// The id field is shared across all types created by createType.
const idField = createTailorDBField("uuid");
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
  const fields = resolveFieldMap(descriptors);
  const allFields = { id: idField.clone(), ...fields } as { id: IdField } & ResolvedFieldMap<D>;

  const dbType = createTailorDBType(typeName, allFields, {
    pluralForm,
    description: options?.description,
  });

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
