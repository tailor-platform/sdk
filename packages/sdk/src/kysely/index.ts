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
import type {
  IsAutoFilledDBField,
  IsReadOnlyDBField,
  TailorAnyDBField,
  TailorAnyDBType,
} from "#/configure/services/tailordb/types";
import type { output, TypeLevelError } from "#/types/helpers";
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

/** The host `Temporal` namespace, re-exported so generated code never imports `temporal-spec` directly (avoids phantom dependency issues with pnpm). */
export type { Temporal } from "temporal-spec";

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
/** Column type for a `date` field read back as `Temporal.PlainDate` (`getDB`'s `temporal` option). */
export type TemporalDate = ColumnType<
  Temporal.PlainDate,
  Temporal.PlainDate | string,
  Temporal.PlainDate | string
>;
/** Column type for a `datetime` field read back as `Temporal.Instant` (`getDB`'s `temporal` option). */
export type TemporalInstant = ColumnType<
  Temporal.Instant,
  Temporal.Instant | string,
  Temporal.Instant | string
>;
/** Column type for a `time` field read back as `Temporal.PlainTime` (`getDB`'s `temporal` option). */
export type TemporalTime = ColumnType<
  Temporal.PlainTime,
  Temporal.PlainTime | string,
  Temporal.PlainTime | string
>;
type ResolveSelect<T> = T extends ColumnType<infer S, unknown, unknown> ? S : T;
type ResolveInsert<T> = T extends ColumnType<unknown, infer I, unknown> ? I : T;
type ResolveUpdate<T> = T extends ColumnType<unknown, unknown, infer U> ? U : T;
export type ObjectColumnType<T> = ColumnType<
  { [K in keyof T]-?: Exclude<ResolveSelect<T[K]>, undefined> },
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

/** Options accepted by a `getDB` function created with {@link createGetDB}. */
export type GetDBConfig = Omit<KyselyConfig, "dialect"> & {
  /**
   * When `true`, date/datetime/time fields with no explicit `as` come back as
   * `Temporal.PlainDate`/`Temporal.Instant`/`Temporal.PlainTime` instead of `Date`. Pass
   * the same value to `IsTemporal` on {@link TailorDBSelectable} (and the `temporal`
   * option `kyselyTypePlugin` was configured with, for generated table types) so the
   * static types match this runtime behavior. Defaults to `false`.
   */
  temporal?: boolean;
};

/**
 * Create a namespace-aware getDB function for generated code.
 * @returns A getDB function that creates Kysely instances for specific namespaces
 */
export function createGetDB<NS>() {
  return function getDB<const N extends keyof NS & string>(
    namespace: N,
    config?: GetDBConfig,
  ): TailordbKysely<NS[N]> {
    const { temporal, ...kyselyConfig } = config ?? {};
    const client = new tailordb.Client({ namespace, temporal });
    return new Kysely<NS[N]>({
      ...kyselyConfig,
      dialect: new TailordbDialect(client),
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
// object also resolves to Timestamp (or its Temporal counterpart under `IsTemporal`). The
// optional marker matches what the output type gives them, which is what the generator
// emits too.
// `-readonly` because a field collection is inferred with `const`, and the generated
// table interfaces declare their nested props mutable.
type NestedProps<Fields, IsTemporal extends boolean> = {
  -readonly [K in keyof Fields as null extends output<Fields[K]> ? never : K]: DBColumn<
    Fields[K],
    IsTemporal
  >;
} & {
  -readonly [K in keyof Fields as null extends output<Fields[K]> ? K : never]?: DBColumn<
    Fields[K],
    IsTemporal
  >;
};

// The generator reaches for ObjectColumnType only when the object holds something whose
// select and insert types differ: a date/datetime/time field with no explicit `as` (which
// resolves to a ColumnType, Temporal or not), an optional prop, or a filled-in one.
type NestedNeedsColumnType<Fields, IsTemporal extends boolean> = true extends {
  [K in keyof Fields]: DBFieldType<Fields[K]> extends "nested"
    ? NestedNeedsColumnType<NestedFieldsOf<Fields[K]>, IsTemporal>
    : ElementColumn<Fields[K], IsTemporal> extends ColumnType<unknown, unknown, unknown>
      ? true
      : null extends output<Fields[K]>
        ? true
        : Fields[K] extends TailorAnyDBField
          ? IsAutoFilledDBField<Fields[K]>
          : false;
}[keyof Fields]
  ? true
  : false;

type NestedColumn<F, IsTemporal extends boolean> =
  NestedNeedsColumnType<NestedFieldsOf<F>, IsTemporal> extends true
    ? ObjectColumnType<FlattenColumns<NestedProps<NestedFieldsOf<F>, IsTemporal>>>
    : FlattenColumns<NestedProps<NestedFieldsOf<F>, IsTemporal>>;

// `as: "temporal"` already resolves ElementOutput to a concrete Temporal.* type (see
// `DateFieldValue`/`DateTimeFieldValue`/`TimeFieldValue`) that the runtime and the
// generator agree on, so that's the only case this checks for — an explicit `as: "date"`
// still lands in the `false` branch below (same as no `as` at all) and keeps today's
// `Timestamp`/`string` mapping, only becoming Temporal when `getDB` is given
// `{ temporal: true }`. That's an unavoidable type-level blind spot: `as`'s value isn't
// tracked at the type level, only its effect on ElementOutput is, so a field explicitly
// pinned to "date" while IsTemporal is true still resolves to a Temporal column here.
type HasExplicitTemporalAs<T> = T extends Temporal.PlainDate | Temporal.Instant | Temporal.PlainTime
  ? true
  : false;

type DefaultDateColumn<
  Type extends "date" | "datetime" | "time",
  IsTemporal extends boolean,
> = IsTemporal extends true
  ? Type extends "date"
    ? TemporalDate
    : Type extends "datetime"
      ? TemporalInstant
      : TemporalTime
  : Type extends "date" | "datetime"
    ? Timestamp
    : string;

type ElementColumn<F, IsTemporal extends boolean> =
  DBFieldType<F> extends "nested"
    ? NestedColumn<F, IsTemporal>
    : DBFieldType<F> extends "date" | "datetime" | "time"
      ? HasExplicitTemporalAs<ElementOutput<F>> extends true
        ? ElementOutput<F>
        : DefaultDateColumn<DBFieldType<F>, IsTemporal>
      : ElementOutput<F>;

// A ColumnType cannot sit inside an array — Kysely only unwraps it at the top level of a
// table property — so an array of them keeps the ColumnType outermost.
type ArrayedColumn<F, IsTemporal extends boolean> =
  IsArrayDBField<F> extends true
    ? ElementColumn<F, IsTemporal> extends ColumnType<unknown, unknown, unknown>
      ? ArrayColumnType<ElementColumn<F, IsTemporal>>
      : ElementColumn<F, IsTemporal>[]
    : ElementColumn<F, IsTemporal>;

type NullableColumn<F, IsTemporal extends boolean> =
  null extends output<F> ? ArrayedColumn<F, IsTemporal> | null : ArrayedColumn<F, IsTemporal>;

type DBColumn<F, IsTemporal extends boolean> = F extends TailorAnyDBField
  ? IsReadOnlyDBField<F> extends true
    ? Serial<NullableColumn<F, IsTemporal>>
    : IsAutoFilledDBField<F> extends true
      ? Generated<NullableColumn<F, IsTemporal>>
      : NullableColumn<F, IsTemporal>
  : never;

// The column map the three derived types are built from. Not exported: it is how the
// mapping is expressed, not something callers need to name.
type TailorDBColumns<T extends TailorDBColumnsSource, IsTemporal extends boolean> = {
  [K in keyof DBFieldsOf<T>]: K extends "id"
    ? Generated<output<DBFieldsOf<T>[K]>>
    : DBColumn<DBFieldsOf<T>[K], IsTemporal>;
};

/**
 * Create input derived from a TailorDB table (`typeof myTable`) or a field collection.
 *
 * Each field resolves to the column type `kyselyTypePlugin` writes for it, so this and
 * the generated table types agree: `.serial()` fields are never caller-supplied,
 * `.default()` / `.hooks({ create })` fields may be omitted, optional fields stay
 * optional, `id` is platform-generated, and a date/datetime/time field with no explicit
 * `as` reads back as `Date` (or its `Temporal` counterpart when `IsTemporal` is `true`).
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
 * @param IsTemporal - Pass `true` to accept `Temporal.PlainDate`/`Temporal.Instant`/
 * `Temporal.PlainTime` (alongside a plain string) for date/datetime/time fields with no
 * explicit `as`, matching a `getDB` call made with `{ temporal: true }`. Defaults to
 * `false`.
 * @example
 * function createInput<const F extends Record<string, TailorAnyDBField>>(fields: F) {
 *   return (input: TailorDBInsertable<F>) => { ... };
 * }
 */
export type TailorDBInsertable<
  T extends TailorDBColumnsSource,
  IsTemporal extends boolean = false,
> = FlattenColumns<Insertable<TailorDBColumns<T, IsTemporal>>>;

/**
 * Read shape of a TailorDB table or field collection. See {@link TailorDBInsertable}.
 * @param IsTemporal - Pass `true` to read date/datetime/time fields with no explicit
 * `as` back as `Temporal.PlainDate`/`Temporal.Instant`/`Temporal.PlainTime`, matching a
 * `getDB` call made with `{ temporal: true }`. Defaults to `false` (`Date`).
 */
export type TailorDBSelectable<
  T extends TailorDBColumnsSource,
  IsTemporal extends boolean = false,
> = FlattenColumns<Selectable<TailorDBColumns<T, IsTemporal>>>;

/** Update input for a TailorDB table or field collection. See {@link TailorDBInsertable}. */
export type TailorDBUpdateable<
  T extends TailorDBColumnsSource,
  IsTemporal extends boolean = false,
> = FlattenColumns<Updateable<TailorDBColumns<T, IsTemporal>>>;
