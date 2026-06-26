export type Prettify<T> = {
  [K in keyof T as string extends K ? never : K]: T[K];
} & {};

export interface TypeLevelError<Message extends string> {
  readonly $error: Message;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type DeepWritable<T> = T extends Date | RegExp | Function
  ? T
  : T extends object
    ? { -readonly [P in keyof T]: DeepWritable<T[P]> } & {}
    : T;

type LiteralToString<T> = T extends string ? string : T;
type SpecificNumberToNumber<T> = T extends number ? number : T;
type TrueFalseToBool<T> = T extends number ? number : T;
type Widening<T> = TrueFalseToBool<SpecificNumberToNumber<LiteralToString<T>>>;
export type DeepWidening<T> = T extends object
  ? { [K in keyof T]: DeepWidening<T[K]> }
  : Widening<T>;

export type output<T> = T extends { _output: infer U } ? DeepWritable<U> : never;

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
