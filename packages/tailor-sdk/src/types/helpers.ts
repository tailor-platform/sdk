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
