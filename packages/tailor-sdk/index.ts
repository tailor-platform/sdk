import type { output as _output } from "./types/helpers";

export * from "./schema-generator";

export { db } from "./tailordb/index";
export { _output as infer, _output as output };
export namespace t {
  export type output<T> = _output<T>;
  export type infer<T> = _output<T>;
}

export * from "./pipeline";

export { t } from "./types";

export { Tailor } from "./workspace";
