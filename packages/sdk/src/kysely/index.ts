/**
 * Kysely integration module for generated TailorDB code.
 *
 * Re-exports kysely and function-kysely-tailordb types through a single import path
 * to avoid phantom dependency issues with pnpm, and provides the namespace-aware
 * utility types and factory functions the code generator emits against.
 *
 * It also holds the `TailorDB*` input types, which hand-written code uses to derive
 * create/read/update shapes straight from a table or field collection. They live here
 * rather than in the main entry point because they are built out of kysely's column
 * types, which the main entry point does not otherwise depend on.
 */

import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
import {
  type ColumnType,
  Kysely,
  type Insertable,
  type KyselyConfig,
  type Selectable,
  type Transaction as KyselyTransaction,
  type Updateable,
} from "kysely";
import { withDecimal, type DecimalClass } from "./decimal-client";
import type {
  IsAutoFilledDBField,
  IsReadOnlyDBField,
  TailorAnyDBField,
  TailorAnyDBType,
} from "#/configure/services/tailordb/types";
import type { output, TypeLevelError } from "#/types/helpers";
import type { Decimal } from "decimal.js";
import type { Temporal } from "temporal-spec";

export {
  type ColumnType,
  Kysely,
  type KyselyConfig,
  type Transaction,
  type Insertable,
  type Selectable,
  sql,
  type Updateable,
} from "kysely";

export { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";

/** Types of the `Temporal` values that date/datetime/time columns read back as when Temporal mode is enabled. */
export type { Temporal } from "temporal-spec";

/** Type of the `Decimal` values that decimal columns read back as when the decimal option is enabled. */
export type { Decimal } from "decimal.js";

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
/** Column type for a `date` field read back as `Temporal.PlainDate` (`createGetDB`'s `temporal` option). */
export type TemporalDate = ColumnType<
  Temporal.PlainDate,
  Temporal.PlainDate | string,
  Temporal.PlainDate | string
>;
/** Column type for a `datetime` field read back as `Temporal.Instant` (`createGetDB`'s `temporal` option). */
export type TemporalInstant = ColumnType<
  Temporal.Instant,
  Temporal.Instant | string,
  Temporal.Instant | string
>;
/** Column type for a `time` field read back as `Temporal.PlainTime` (`createGetDB`'s `temporal` option). */
export type TemporalTime = ColumnType<
  Temporal.PlainTime,
  Temporal.PlainTime | string,
  Temporal.PlainTime | string
>;
/** Column type for a `decimal` field read back as a `Decimal` (`createGetDB`'s `decimal` option). */
export type DecimalValue = ColumnType<Decimal, Decimal | string, Decimal | string>;
type ResolveSelect<T> = T extends ColumnType<infer S, unknown, unknown> ? S : T;
type ResolveInsert<T> = T extends ColumnType<unknown, infer I, unknown> ? I : T;
type ResolveUpdate<T> = T extends ColumnType<unknown, unknown, infer U> ? U : T;
export type ObjectColumnType<T> = ColumnType<
  { [K in keyof T]: ResolveSelect<T[K]> },
  { [K in keyof T]: ResolveInsert<T[K]> },
  { [K in keyof T]: ResolveUpdate<T[K]> }
>;
export type ArrayColumnType<T> = ColumnType<
  ResolveSelect<T>[],
  ResolveInsert<T>[],
  ResolveUpdate<T>[]
>;
export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>;
// The insert/update types carry the reason so that supplying a value fails with it,
// instead of the bare "does not exist" an absent key produces. The named alias is
// what survives in nested positions (values()/set()), where tsc elides the marker's
// type argument and only the name reaches the user.
// `| undefined` is what makes the column omittable; Kysely drops undefined columns
// from the statement, so passing it explicitly is the same as leaving it out.
type SerialColumnMustBeOmitted = TypeLevelError<"assigned by .serial(); remove it from the input">;
export type Serial<T = string | number> = ColumnType<
  T,
  SerialColumnMustBeOmitted | undefined,
  SerialColumnMustBeOmitted | undefined
>;

// Kysely composes its input types out of intersections. Flattening them keeps the
// shape readable in assignability errors and editor tooltips.
type FlattenColumns<T> = { [K in keyof T]: T[K] } & {};

export type TailordbKysely<DB> = Kysely<DB>;
export type NamespaceDB<NS, N extends keyof NS = keyof NS> = TailordbKysely<NS[N]>;

/** Options for {@link createGetDB}. */
export type CreateGetDBOptions = {
  /**
   * When `true`, date/datetime fields come back as `Temporal.PlainDate`/
   * `Temporal.Instant`, and top-level time fields come back as `Temporal.PlainTime`,
   * instead of `Date`/`string`. Nested time fields remain strings. Match the `temporal`
   * option `kyselyTypePlugin` was configured with so the generated table types agree
   * with this runtime behavior. Defaults to `false`.
   */
  temporal?: boolean;
  /**
   * The `Decimal` class to read TailorDB decimal fields as, such as the one exported by
   * `@tailor-platform/sdk/runtime`. When given, decimal columns come back as `Decimal` instead of
   * strings and `Decimal` values are accepted as query parameters. Match the `decimal` option
   * `kyselyTypePlugin` was configured with so the generated table types agree with this runtime
   * behavior. Defaults to strings.
   */
  decimal?: DecimalClass;
};

/**
 * Create a namespace-aware getDB function for generated code.
 * @param options - Settings applied to every Kysely instance the returned `getDB` creates
 * @returns A getDB function that creates Kysely instances for specific namespaces
 */
export function createGetDB<NS>(options: CreateGetDBOptions = {}) {
  const { temporal, decimal } = options;
  return function getDB<const N extends keyof NS & string>(
    namespace: N,
    config?: Omit<KyselyConfig, "dialect">,
  ): TailordbKysely<NS[N]> {
    const client = new tailordb.Client({ namespace, ...(temporal ? { temporal } : {}) });
    return new Kysely<NS[N]>({
      ...config,
      dialect: new TailordbDialect(decimal ? withDecimal(client, decimal) : client),
    });
  };
}

export type NamespaceTransaction<NS, K extends keyof NS | TailordbKysely<NS[keyof NS]> = keyof NS> =
  K extends TailordbKysely<infer DB>
    ? KyselyTransaction<DB>
    : K extends keyof NS
      ? KyselyTransaction<NS[K]>
      : never;

export type NamespaceTableName<NS> = {
  [N in keyof NS]: keyof NS[N];
}[keyof NS];

export type NamespaceTable<NS, T extends NamespaceTableName<NS>> = {
  [N in keyof NS]: T extends keyof NS[N] ? NS[N][T] : never;
}[keyof NS];

export type NamespaceInsertable<NS, T extends NamespaceTableName<NS>> = FlattenColumns<
  Insertable<NamespaceTable<NS, T>>
>;
export type NamespaceSelectable<NS, T extends NamespaceTableName<NS>> = FlattenColumns<
  Selectable<NamespaceTable<NS, T>>
>;
export type NamespaceUpdateable<NS, T extends NamespaceTableName<NS>> = FlattenColumns<
  Updateable<NamespaceTable<NS, T>>
>;

/** What the derived input types accept: a table (`typeof myTable`) or a field collection. */
type TailorDBColumnsSource = TailorAnyDBType | Record<string, TailorAnyDBField>;

type DBFieldsOf<T> = T extends TailorAnyDBType ? T["fields"] : T;

// The column mapping below mirrors the one `kyselyTypePlugin` applies when it writes a
// table interface (`plugin/builtin/kysely-type/type-processor.ts`), so both surfaces
// resolve a field to the same column type — including inside nested objects, where the
// function runtime also hands back a Date for a date/datetime.
// `example/tests/kysely-parity.ts` pins the two against each other on real generator output.
type DBFieldType<F> = F extends TailorAnyDBField ? F["_defined"]["type"] : never;
type IsArrayDBField<F> = F extends TailorAnyDBField
  ? F["_defined"]["array"] extends true
    ? true
    : false
  : false;

type Unwrapped<F> = Exclude<output<F>, null>;
type ElementOutput<F> =
  IsArrayDBField<F> extends true
    ? Unwrapped<F> extends readonly (infer E)[]
      ? E
      : Unwrapped<F>
    : Unwrapped<F>;

type NestedFieldsOf<F> = F extends TailorAnyDBField ? F["fields"] : never;

// Nested props carry the same column mapping as top-level ones, so a datetime inside an
// object also resolves to Timestamp (or its Temporal counterpart under `M`). The
// optional marker matches what the output type gives them, which is what the generator
// emits too.
// `-readonly` because a field collection is inferred with `const`, and the generated
// table interfaces declare their nested props mutable.
type NestedProps<Fields, M extends ColumnModes> = {
  -readonly [K in keyof Fields as null extends output<Fields[K]> ? never : K]: DBColumn<
    Fields[K],
    M,
    true
  >;
} & {
  -readonly [K in keyof Fields as null extends output<Fields[K]> ? K : never]?: DBColumn<
    Fields[K],
    M,
    true
  >;
};

type NestedNeedsColumnType<Fields, M extends ColumnModes> = true extends {
  [K in keyof Fields]: DBFieldType<Fields[K]> extends "nested"
    ? NestedNeedsColumnType<NestedFieldsOf<Fields[K]>, M>
    : ElementColumn<Fields[K], M, true> extends ColumnType<unknown, unknown, unknown>
      ? true
      : Fields[K] extends TailorAnyDBField
        ? IsAutoFilledDBField<Fields[K]>
        : false;
}[keyof Fields]
  ? true
  : false;

type NestedColumn<F, M extends ColumnModes> =
  NestedNeedsColumnType<NestedFieldsOf<F>, M> extends true
    ? ObjectColumnType<FlattenColumns<NestedProps<NestedFieldsOf<F>, M>>>
    : FlattenColumns<NestedProps<NestedFieldsOf<F>, M>>;

type DateColumn<
  Type extends "date" | "datetime" | "time",
  IsTemporal extends boolean,
  IsNested extends boolean,
> = IsTemporal extends true
  ? Type extends "date"
    ? TemporalDate
    : Type extends "datetime"
      ? TemporalInstant
      : IsNested extends true
        ? string
        : TemporalTime
  : Type extends "date" | "datetime"
    ? Timestamp
    : string;

type DecimalColumn<F, IsDecimal extends boolean, IsNested extends boolean> = IsNested extends true
  ? ElementOutput<F>
  : IsDecimal extends true
    ? DecimalValue
    : ElementOutput<F>;

type ElementColumn<F, M extends ColumnModes, IsNested extends boolean> =
  DBFieldType<F> extends "nested"
    ? NestedColumn<F, M>
    : DBFieldType<F> extends "date" | "datetime" | "time"
      ? DateColumn<DBFieldType<F>, M["temporal"], IsNested>
      : DBFieldType<F> extends "decimal"
        ? DecimalColumn<F, M["decimal"], IsNested>
        : ElementOutput<F>;

// A ColumnType cannot sit inside an array — Kysely only unwraps it at the top level of a
// table property — so an array of them keeps the ColumnType outermost.
type ArrayedColumn<F, M extends ColumnModes, IsNested extends boolean> =
  IsArrayDBField<F> extends true
    ? ElementColumn<F, M, IsNested> extends ColumnType<unknown, unknown, unknown>
      ? ArrayColumnType<ElementColumn<F, M, IsNested>>
      : ElementColumn<F, M, IsNested>[]
    : ElementColumn<F, M, IsNested>;

type NullableColumn<F, M extends ColumnModes, IsNested extends boolean> =
  null extends output<F> ? ArrayedColumn<F, M, IsNested> | null : ArrayedColumn<F, M, IsNested>;

type DBColumn<
  F,
  M extends ColumnModes,
  IsNested extends boolean = false,
> = F extends TailorAnyDBField
  ? IsReadOnlyDBField<F> extends true
    ? Serial<NullableColumn<F, M, IsNested>>
    : IsAutoFilledDBField<F> extends true
      ? Generated<NullableColumn<F, M, IsNested>>
      : NullableColumn<F, M, IsNested>
  : never;

// Which opt-in column representations a table's columns use; the two flags are the type
// parameters of the derived types below.
type ColumnModes = { temporal: boolean; decimal: boolean };

// The column map the three derived types are built from. Not exported: it is how the
// mapping is expressed, not something callers need to name.
type TailorDBColumns<T extends TailorDBColumnsSource, M extends ColumnModes> = {
  [K in keyof DBFieldsOf<T>]: K extends "id"
    ? Generated<output<DBFieldsOf<T>[K]>>
    : DBColumn<DBFieldsOf<T>[K], M>;
};

/**
 * Create input derived from a TailorDB table (`typeof myTable`) or a field collection.
 *
 * Each field resolves to the column type `kyselyTypePlugin` writes for it, so this and
 * the generated table types agree: `.serial()` fields are never caller-supplied,
 * `.default()` / `.hooks({ create })` fields may be omitted, optional fields stay
 * optional, `id` is platform-generated, and date/datetime/time fields read back as
 * `Date`/`string`, or as their `Temporal` counterparts when `IsTemporal` is `true`.
 * Nested time fields remain strings in either mode.
 *
 * Pass a field collection when the fields are a type parameter — a shared module that
 * lets each project extend a table with its own fields cannot name a generated table
 * type. Declare it as `<const F extends Record<string, TailorAnyDBField>>` so the field
 * types are inferred; a bare `Record<string, TailorAnyDBField>` erases them and nothing
 * is checked.
 *
 * Hand the result to callers rather than consuming it inside the generic that declares
 * it: while `F` is still an unresolved type parameter the mapping stays deferred, so
 * assigning to it inside the function body reports the unevaluated conditional rather
 * than a readable shape.
 * @param IsTemporal - Pass `true` to accept `Temporal.PlainDate`/`Temporal.Instant` for
 * date/datetime fields and `Temporal.PlainTime` for top-level time fields (alongside a
 * plain string), matching a `getDB` created with `createGetDB({ temporal: true })`.
 * Nested time fields remain strings. Defaults to `false`.
 * @param IsDecimal - Pass `true` to accept `Decimal` for decimal fields (alongside a plain
 * string), matching a `getDB` created with `createGetDB({ decimal: Decimal })`. A decimal
 * field nested inside an object remains a string. Defaults to `false`.
 * @example
 * function createInput<const F extends Record<string, TailorAnyDBField>>(fields: F) {
 *   return (input: TailorDBInsertable<F>) => { ... };
 * }
 */
export type TailorDBInsertable<
  T extends TailorDBColumnsSource,
  IsTemporal extends boolean = false,
  IsDecimal extends boolean = false,
> = FlattenColumns<Insertable<TailorDBColumns<T, { temporal: IsTemporal; decimal: IsDecimal }>>>;

/**
 * Read shape of a TailorDB table or field collection. See {@link TailorDBInsertable}.
 * @param IsTemporal - Pass `true` to read date/datetime fields as `Temporal.PlainDate`/
 * `Temporal.Instant` and top-level time fields as `Temporal.PlainTime`, matching a
 * `getDB` created with `createGetDB({ temporal: true })`. Nested time fields remain
 * strings. Defaults to `false` (`Date` for date/datetime, `string` for time).
 * @param IsDecimal - Pass `true` to read decimal fields as `Decimal`, matching a `getDB`
 * created with `createGetDB({ decimal: Decimal })`. A decimal field nested inside an object
 * remains a string. Defaults to `false` (`string`).
 */
export type TailorDBSelectable<
  T extends TailorDBColumnsSource,
  IsTemporal extends boolean = false,
  IsDecimal extends boolean = false,
> = FlattenColumns<Selectable<TailorDBColumns<T, { temporal: IsTemporal; decimal: IsDecimal }>>>;

/** Update input for a TailorDB table or field collection. See {@link TailorDBInsertable}. */
export type TailorDBUpdateable<
  T extends TailorDBColumnsSource,
  IsTemporal extends boolean = false,
  IsDecimal extends boolean = false,
> = FlattenColumns<Updateable<TailorDBColumns<T, { temporal: IsTemporal; decimal: IsDecimal }>>>;
