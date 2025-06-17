import type { output as _output } from "./types/helpers";

export * from "./schema-generator";

export { _output as infer, _output as output };
export namespace t {
  export type output<T> = _output<T>;
  export type infer<T> = _output<T>;
}

export { t } from "./types";

export * from "./services";

export { Tailor } from "./tailor";
export { Workspace } from "./workspace";
