import { t as _t } from "@/configure/types";
import type { output as _output } from "@/configure/types/helpers";

export type infer<T> = _output<T>;
export type output<T> = _output<T>;

// eslint-disable-next-line import/export
export const t = { ..._t };
// eslint-disable-next-line @typescript-eslint/no-namespace, import/export
export namespace t {
  export type output<T> = _output<T>;
  export type infer<T> = _output<T>;
}

export * from "@/configure/services";

export { defineConfig, defineGenerators } from "@/configure/config";
