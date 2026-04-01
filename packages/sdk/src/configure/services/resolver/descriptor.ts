import { type AllowedValues, type AllowedValuesOutput } from "@/configure/types/field";
import { type TailorAnyField, type TailorField, createTailorField } from "@/configure/types/type";
import type { InferFieldsOutput } from "@/configure/types/helpers";
import type { TailorFieldType, TailorToTs, FieldOptions } from "@/configure/types/types";
import type { FieldValidateInput, ValidateConfig } from "@/configure/types/validation";

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

type ValidatableOptions<O = unknown> = {
  validate?: FieldValidateInput<O> | FieldValidateInput<O>[];
};

type SimpleDescriptor<K extends keyof KindToTsType> = CommonFieldOptions &
  ValidatableOptions<KindToTsType[K]> & {
    kind: K;
  };

type EnumDescriptor<V extends AllowedValues = AllowedValues> = CommonFieldOptions &
  ValidatableOptions<AllowedValuesOutput<V>> & {
    kind: "enum";
    values: V;
    typeName?: string;
  };

type ObjectDescriptor = CommonFieldOptions & {
  kind: "object";
  fields: Record<string, ResolverFieldEntry>;
  typeName?: string;
};

export type ResolverFieldDescriptor =
  | SimpleDescriptor<"string">
  | SimpleDescriptor<"int">
  | SimpleDescriptor<"float">
  | SimpleDescriptor<"bool">
  | SimpleDescriptor<"uuid">
  | SimpleDescriptor<"decimal">
  | SimpleDescriptor<"date">
  | SimpleDescriptor<"datetime">
  | SimpleDescriptor<"time">
  | EnumDescriptor
  | ObjectDescriptor;

export type ResolverFieldEntry = ResolverFieldDescriptor | TailorAnyField;

// --- Type-level output inference ---

type DescriptorBaseOutput<D extends ResolverFieldDescriptor> = D extends {
  kind: "enum";
  values: infer V;
}
  ? V extends AllowedValues
    ? AllowedValuesOutput<V>
    : string
  : D extends { kind: "object"; fields: infer F }
    ? F extends Record<string, ResolverFieldEntry>
      ? InferFieldsOutput<ResolvedResolverFieldMap<F>>
      : Record<string, unknown>
    : D["kind"] extends keyof KindToTsType
      ? KindToTsType[D["kind"]]
      : unknown;

type ApplyArrayAndOptional<T, D extends ResolverFieldDescriptor> = D extends { array: true }
  ? D extends { optional: true }
    ? T[] | null
    : T[]
  : D extends { optional: true }
    ? T | null
    : T;

export type ResolverDescriptorOutput<D extends ResolverFieldDescriptor> = ApplyArrayAndOptional<
  DescriptorBaseOutput<D>,
  D
>;

type DescriptorDefined<D extends ResolverFieldDescriptor> = {
  type: D["kind"] extends keyof KindToFieldType ? KindToFieldType[D["kind"]] : TailorFieldType;
  array: D extends { array: true } ? true : false;
};

export type ResolvedResolverField<E extends ResolverFieldEntry> = E extends ResolverFieldDescriptor
  ? TailorField<DescriptorDefined<E>, ResolverDescriptorOutput<E>>
  : E;

export type ResolvedResolverFieldMap<M extends Record<string, ResolverFieldEntry>> = {
  [K in keyof M]: ResolvedResolverField<M[K]>;
};

// --- Runtime conversion ---

function isPassthroughField(entry: ResolverFieldEntry): entry is TailorAnyField {
  return !isResolverFieldDescriptor(entry);
}

export function isResolverFieldDescriptor(
  entry: ResolverFieldEntry,
): entry is ResolverFieldDescriptor {
  return (
    "kind" in entry &&
    typeof (entry as { kind: unknown }).kind === "string" &&
    (entry as { kind: string }).kind in kindToFieldType
  );
}

function isValidateConfig(v: unknown): v is ValidateConfig<unknown> {
  return Array.isArray(v) && v.length === 2 && typeof v[1] === "string";
}

export function resolveResolverField(entry: ResolverFieldEntry): TailorAnyField {
  if (isPassthroughField(entry)) {
    return entry;
  }
  return buildResolverField(entry);
}

export function resolveResolverFieldMap(
  entries: Record<string, ResolverFieldEntry>,
): Record<string, TailorAnyField> {
  // Fast path: if no descriptors are present, return the original object as-is
  const hasDescriptors = Object.values(entries).some(isResolverFieldDescriptor);
  if (!hasDescriptors) {
    return entries as Record<string, TailorAnyField>;
  }
  return Object.fromEntries(
    Object.entries(entries).map(([key, entry]) => [key, resolveResolverField(entry)]),
  );
}

function buildResolverField(descriptor: ResolverFieldDescriptor): TailorAnyField {
  const fieldType = kindToFieldType[descriptor.kind];
  const options: FieldOptions = {
    ...(descriptor.optional === true && { optional: true as const }),
    ...(descriptor.array === true && { array: true as const }),
  };
  const values = descriptor.kind === "enum" ? descriptor.values : undefined;
  const nestedFields =
    descriptor.kind === "object" ? resolveResolverFieldMap(descriptor.fields) : undefined;

  let field: TailorAnyField = createTailorField(fieldType, options, nestedFields, values);

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

  if (descriptor.kind === "object") {
    return field;
  }

  if (descriptor.validate !== undefined) {
    if (Array.isArray(descriptor.validate) && !isValidateConfig(descriptor.validate)) {
      // oxlint-disable-next-line no-explicit-any -- union of typed FieldValidateInput<O> variants; widen to any
      field = field.validate(...(descriptor.validate as any));
    } else {
      // oxlint-disable-next-line no-explicit-any -- union of typed FieldValidateInput<O> variants; widen to any
      field = field.validate(descriptor.validate as any);
    }
  }

  return field;
}
