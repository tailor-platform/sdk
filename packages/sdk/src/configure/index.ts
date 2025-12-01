import { t as _t } from "@/configure/types";
import type * as helperTypes from "@/configure/types/helpers";

type TailorOutput<T> = helperTypes.output<T>;

export type infer<T> = TailorOutput<T>;
export type output<T> = TailorOutput<T>;

// eslint-disable-next-line import/export
export const t = { ..._t };
// eslint-disable-next-line @typescript-eslint/no-namespace, import/export
export namespace t {
  export type output<T> = TailorOutput<T>;
  export type infer<T> = TailorOutput<T>;
}

export {
  TailorField,
  type TailorUser,
  unauthenticatedTailorUser,
  type AttributeMap,
  type AttributeList,
  type Env,
} from "@/configure/types";

export * from "@/configure/services";

export { defineConfig, defineGenerators } from "@/configure/config";
