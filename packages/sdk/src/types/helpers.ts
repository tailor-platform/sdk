export type Prettify<T> = {
  [K in keyof T as string extends K ? never : K]: T[K];
} & {};

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

/**
 * A looser version of JsonValue that accepts interfaces.
 * TypeScript interfaces don't have index signatures by default,
 * so they can't be assigned to JsonValue's {[Key in string]: JsonValue}.
 * This type uses a recursive check instead.
 */
export type JsonCompatible<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer U)[]
    ? JsonCompatible<U>[]
    : T extends object
      ? T extends { toJSON: () => unknown }
        ? never // Exclude objects with toJSON (like Date) from input
        : { [K in keyof T]: JsonCompatible<T[K]> }
      : never;
