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

export { defineConfig, defineGenerators, definePlugins } from "@/configure/config";

// Plugin types for custom plugin development
export type {
  PluginBase,
  PluginConfig,
  PluginConfigs,
  PluginOutput,
  PluginProcessContext,
  PluginAttachment,
  PluginGeneratedType,
  PluginGeneratedResolver,
  PluginGeneratedExecutor,
  TailorDBTypeForPlugin,
} from "@/parser/plugin-config/types";
