import type { output as _output } from "@/types/helpers";
import { t as _t } from "@/types";

export type infer<T> = _output<T>;
export type output<T> = _output<T>;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace t {
  export type output<T> = _output<T>;
  export type infer<T> = _output<T>;
}
export const t = { ..._t };

export * from "@/services";

export { defineConfig } from "@/config";
export { apply } from "@/workspace";
export { generate } from "@/generator";
