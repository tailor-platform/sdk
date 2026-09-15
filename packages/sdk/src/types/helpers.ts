export type Prettify<T> = {
  [K in keyof T as string extends K ? never : K]: T[K];
} & {};

export type TypeLevelError<Message extends string> = {
  readonly $error: Message;
};

export type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

export type IsUnion<T, U extends T = T> = T extends unknown
  ? [U] extends [T]
    ? false
    : true
  : never;

// Reading the bare name `Temporal.PlainDate` here would force every
// consumer's tsc to resolve the ambient `Temporal` global to type-check this
// module's declarations (even under `skipLibCheck: false`, and even for
// consumers who never touch a `temporal` date field), because it's a
// generic type alias whose full definition ships in the public `.d.ts`.
// Reaching it structurally through `globalThis` instead means a `lib`
// without `Temporal` makes this resolve to `never` — a silent no-op in the
// unions below — rather than a compile error.
export type TemporalPlainDate = typeof globalThis extends { Temporal: infer T }
  ? T extends { PlainDate: new (...args: never[]) => infer Instance }
    ? Instance
    : never
  : never;

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type DeepWritable<T> = T extends Date | TemporalPlainDate | RegExp | Function
  ? T
  : T extends object
    ? { -readonly [P in keyof T]: DeepWritable<T[P]> } & {}
    : T;

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type DeepReadonly<T> = T extends Date | TemporalPlainDate | RegExp | Function
  ? T
  : T extends readonly (infer E)[]
    ? readonly DeepReadonly<E>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export type output<T> = T extends { _output: infer U } ? DeepWritable<U> : never;

/**
 * Replace `Date` and `Temporal.PlainDate` with `string` throughout a type.
 *
 * Values that reach user code as a parsed JSON payload cannot carry a `Date`
 * or `Temporal.PlainDate` instance, so a type describing such a payload must
 * report the serialized form even when the type it derives from uses one of
 * those representations.
 */
export type SerializeDates<T> = T extends Date | TemporalPlainDate
  ? string
  : // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    T extends RegExp | Function
    ? T
    : T extends object
      ? { [K in keyof T]: SerializeDates<T[K]> }
      : T;

export type NullableToOptional<T> = {
  [K in keyof T as null extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as null extends T[K] ? K : never]?: T[K];
};

// Return Output type for TailorFields.
// `_output` is intentionally unconstrained across field implementations.
// oxlint-disable-next-line no-explicit-any
export type InferFieldsOutput<F extends Record<string, { _output: any; [key: string]: any }>> =
  DeepWritable<
    Prettify<
      NullableToOptional<{
        [K in keyof F]: output<F[K]>;
      }>
    >
  >;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * A looser version of JsonValue that accepts interfaces.
 * TypeScript interfaces don't have index signatures by default, so they can't
 * be assigned to JsonValue's `{ [key: string]: JsonValue }`. This type uses a
 * recursive structural check instead.
 *
 * Rejection rules:
 * - Functions are rejected (top-level or as property values).
 * - Objects with a `toJSON` method are rejected (can't faithfully round-trip).
 * - Class instances that expose methods are rejected via the property walk
 *   (methods are function-typed properties, which resolve to `never`).
 *
 * Limitation: class instances whose declared type has only data properties
 * (for example `Error`, or user-defined DTO classes) are structurally
 * indistinguishable from plain objects and cannot be rejected here. The
 * platform performs the authoritative check at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type JsonCompatible<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer U)[]
    ? JsonCompatible<U>[]
    : // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      T extends Function
      ? never
      : T extends object
        ? T extends { toJSON: () => unknown }
          ? never
          : { [K in keyof T]: JsonCompatible<T[K]> }
        : never;
