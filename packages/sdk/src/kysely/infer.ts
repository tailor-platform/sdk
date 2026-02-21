/**
 * Type-level inference utilities for mapping TailorDB type definitions
 * to Kysely table types without code generation.
 *
 * These types enable `InferTable<typeof myType>` to produce the same
 * Kysely table type that the `@tailor-platform/kysely-type` generator outputs.
 */

import type { Generated, Serial, Timestamp } from "./index";
import type { TailorAnyDBField, TailorAnyDBType } from "@/configure/services/tailordb/schema";

// === Nested output transformation ===

/**
 * Check if K is an optional key in T.
 * `{} extends Pick<T, K>` is true when K is optional, false when required.
 */
type IsOptionalKey<T, K extends keyof T> = object extends Pick<T, K> ? true : false;

/**
 * Transform InferFieldsOutput (with NullableToOptional) to Kysely format.
 * - All properties become required (no `?:`)
 * - Nullable fields use `| null`
 * - datetime (string | Date) is converted to Timestamp
 * - Nested objects are recursively transformed
 */
type OutputToKysely<T> = {
  [K in keyof T]-?: IsOptionalKey<T, K> extends true
    ? TransformFieldValue<NonNullable<T[K]>> | null
    : TransformFieldValue<T[K]>;
};

/**
 * Convert field values to Kysely types:
 * - `string | Date` (datetime) → Timestamp
 * - Arrays → recurse into element type
 * - Nested objects → recurse
 * - Everything else → pass through
 */
type TransformFieldValue<T> = Date extends T
  ? Timestamp
  : T extends (infer E)[]
    ? TransformFieldValue<E>[]
    : T extends Record<string, unknown>
      ? OutputToKysely<T>
      : T;

// === Base type mapping ===

/** Strip null and array wrappers to get the base output type */
type StripNullAndArray<T> = T extends (infer E)[] ? Exclude<E, null> : Exclude<T, null>;

/**
 * Map TailorDBField's `_defined.type` to the corresponding Kysely base type.
 *
 * | _defined.type     | Kysely type                |
 * |-------------------|----------------------------|
 * | string, uuid      | string                     |
 * | integer, float    | number                     |
 * | boolean           | boolean                    |
 * | date, datetime    | Timestamp                  |
 * | time              | string                     |
 * | enum              | literal union from _output |
 * | nested            | recursive object           |
 */
type MapFieldBaseType<F extends TailorAnyDBField> = F["_defined"]["type"] extends "string" | "uuid"
  ? string
  : F["_defined"]["type"] extends "integer" | "float"
    ? number
    : F["_defined"]["type"] extends "boolean"
      ? boolean
      : F["_defined"]["type"] extends "date" | "datetime"
        ? Timestamp
        : F["_defined"]["type"] extends "time"
          ? string
          : F["_defined"]["type"] extends "enum"
            ? StripNullAndArray<F["_output"]>
            : F["_defined"]["type"] extends "nested"
              ? OutputToKysely<StripNullAndArray<F["_output"]>>
              : string;

// === Modifier application (order: base → array → null → Serial → Generated) ===

type WithArray<Base, F extends TailorAnyDBField> = F["_defined"]["array"] extends true
  ? Base[]
  : Base;

type WithNull<T, F extends TailorAnyDBField> = null extends F["_output"] ? T | null : T;

type WithSerial<T, F extends TailorAnyDBField> = F["_defined"] extends { serial: true }
  ? Serial<T>
  : T;

type WithGenerated<T, F extends TailorAnyDBField> = F["_defined"] extends {
  hooks: { create: true };
}
  ? Generated<T>
  : T;

/** Infer a single Kysely column type from a TailorDBField (without Generated wrapper) */
type InferColumnBase<F extends TailorAnyDBField> = WithSerial<
  WithNull<WithArray<MapFieldBaseType<F>, F>, F>,
  F
>;

/** Infer a single Kysely column type from a TailorDBField (with Generated wrapper) */
type InferColumn<F extends TailorAnyDBField> = WithGenerated<InferColumnBase<F>, F>;

/** Check if a field has a create hook via the type-level _hooksMeta */
type HasCreateHookMeta<
  T extends TailorAnyDBType,
  K extends string,
> = K extends keyof T["_hooksMeta"]
  ? T["_hooksMeta"][K] extends { create: true }
    ? true
    : false
  : false;

// === Public API ===

/**
 * Infer a Kysely table type from a TailorDBType definition.
 * @example
 * ```ts
 * const user = db.type("User", { name: db.string(), email: db.string().unique() });
 * type UserTable = InferTable<typeof user>;
 * // { id: Generated<string>; name: string; email: string }
 * ```
 */
export type InferTable<T extends TailorAnyDBType> = {
  [K in keyof T["fields"] & string]: K extends "id"
    ? Generated<string>
    : HasCreateHookMeta<T, K> extends true
      ? Generated<InferColumnBase<T["fields"][K]>>
      : InferColumn<T["fields"][K]>;
};

/**
 * Infer Kysely table types for an entire namespace of TailorDBType definitions.
 * @example
 * ```ts
 * const types = { User: user, Customer: customer };
 * type NS = InferNamespace<typeof types>;
 * // { User: { id: Generated<string>; ... }; Customer: { id: Generated<string>; ... } }
 * ```
 */
export type InferNamespace<T extends Record<string, TailorAnyDBType>> = {
  [K in keyof T]: InferTable<T[K]>;
};

/**
 * Infer a readonly enum record from a TailorDBField with allowed values.
 * @example
 * ```ts
 * const roleField = db.enum(["MANAGER", "STAFF"]);
 * type RoleRecord = EnumRecord<typeof roleField>;
 * // { readonly MANAGER: "MANAGER"; readonly STAFF: "STAFF" }
 * ```
 */
export type EnumRecord<F extends TailorAnyDBField> = {
  readonly [K in StripNullAndArray<F["_output"]> & string]: K;
};
