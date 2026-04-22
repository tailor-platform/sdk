/// <reference types="@tailor-platform/function-types" />
import { t as _t } from "@/configure/types";
import type * as helperTypes from "@/types/helpers";

type TailorOutput<T> = helperTypes.output<T>;

export type infer<T> = TailorOutput<T>;
export type output<T> = TailorOutput<T>;

/** TailorDB field type builders. */
// eslint-disable-next-line import-x/export
export const t = { ..._t };
// eslint-disable-next-line @typescript-eslint/no-namespace, import-x/export
export namespace t {
  export type output<T> = TailorOutput<T>;
  export type infer<T> = TailorOutput<T>;
}

export { type TailorField } from "@/configure/types/type";
export {
  type TailorUser,
  unauthenticatedTailorUser,
  type AttributeMap,
  type AttributeList,
} from "@/types/user";
export { type TailorInvoker } from "@/types/invoker";
export { type Env } from "@/types/env";
export { type MachineUserNameRegistry, type MachineUserName } from "@/configure/types/machine-user";

export * from "@/configure/services";

export { defineConfig, defineGenerators, definePlugins } from "@/configure/config";

// Plugin types for custom plugin development
export type {
  Plugin,
  PluginConfigs,
  PluginOutput,
  TypePluginOutput,
  NamespacePluginOutput,
  PluginProcessContext,
  PluginNamespaceProcessContext,
  PluginAttachment,
  PluginGeneratedType,
  PluginGeneratedResolver,
  PluginGeneratedExecutor,
  PluginGeneratedExecutorWithFile,
  PluginExecutorContext,
  PluginExecutorContextBase,
  TailorDBTypeForPlugin,
} from "@/types/plugin";

// Generation-time hook context types for plugin development
export type {
  TailorDBReadyContext,
  ResolverReadyContext,
  ExecutorReadyContext,
  TailorDBNamespaceData,
  ResolverNamespaceData,
  GeneratorResult,
} from "@/types/plugin-generation";
