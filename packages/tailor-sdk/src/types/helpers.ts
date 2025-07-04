export type Prettify<T> = {
  [K in keyof T as string extends K ? never : K]: T[K];
} & {};

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type DeepWritable<T> = T extends Date | RegExp | Function
  ? T
  : T extends object
    ? { -readonly [P in keyof T]: DeepWritable<T[P]> } & {}
    : T;

type _d = DeepWritable<{
  date: Date;
}>;

type LiteralToString<T> = T extends string ? string : T;
type SpecificNumberToNumber<T> = T extends number ? number : T;
type TrueFalseToBool<T> = T extends number ? number : T;
type Widening<T> = TrueFalseToBool<SpecificNumberToNumber<LiteralToString<T>>>;
export type DeepWidening<T> = T extends object
  ? { [K in keyof T]: DeepWidening<T[K]> }
  : Widening<T>;

export type input<T> = T extends { _input: infer U } ? DeepWritable<U> : never;

export type output<T> = T extends { _output: infer U }
  ? DeepWritable<U>
  : never;

export type StrictOutput<O, R extends Record<string, unknown>> =
  Required<R> extends output<O>
    ? keyof R extends keyof output<O>
      ? R
      : ["unnecessary fields", Exclude<keyof R, keyof output<O>>]
    : output<O>;
