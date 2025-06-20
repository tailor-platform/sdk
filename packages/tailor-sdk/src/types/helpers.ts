export type Prettify<T> = {
  [K in keyof T as string extends K ? never : K]: T[K];
} & {};

export type DeepWriteable<T> = T extends object
  ? { -readonly [P in keyof T]: DeepWriteable<T[P]> } & {}
  : T;

export type input<T> = T extends { _input: infer U } ? DeepWriteable<U> : never;

export type output<T> = T extends { _output: infer U }
  ? DeepWriteable<U>
  : never;

export type StrictOutput<O, R extends Record<string, unknown>> =
  R extends output<O>
    ? keyof R extends keyof output<O>
      ? R
      : never
    : keyof output<O> extends string
      ? ["missing required fields", Exclude<keyof output<O>, keyof R>]
      : never;
