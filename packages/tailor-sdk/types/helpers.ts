export type Prettify<T> =
  & {
    -readonly [K in keyof T]: T[K];
  }
  & {};

export type DeepWriteable<T> = T extends {}
  ? { -readonly [P in keyof T]: DeepWriteable<T[P]> } & {}
  : T;

export type output<T> = T extends { _output: infer U } ? DeepWriteable<U>
  : never;
